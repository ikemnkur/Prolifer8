/**
 * Prolifer8 — API Routes
 *
 * All post, contribution, review, favourite, profile, follower,
 * and dashboard endpoints for the Prolifer8 platform.
 *
 * Mount with:
 *   const prolifer8Routes = require('./prolifer8-routes');
 *   prolifer8Routes(server, pool, authenticateToken, PROXY, { storage, BUCKET_NAME, DEST_PREFIX });
 */

const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl: presignUrl } = require('@aws-sdk/s3-request-presigner');

const knex = require('./config/knex');

// ── Burn-rate engine (matches frontend src/engine/burnRate.ts) ──
const ENGINE_C = parseFloat(process.env.BURN_C || '0.999'); // Decay constant — admin-configurable
const ENGINE_K = parseInt(process.env.BURN_K || '5', 10);   // Loop interval minutes — admin-configurable
const DOWNLOAD_TIME_DECAY_CONSTANT = parseFloat(process.env.DOWNLOAD_TIME_DECAY_CONSTANT || '1');
const DOWNLOAD_SITE_POPULARITY_CONSTANT = parseFloat(process.env.DOWNLOAD_SITE_POPULARITY_CONSTANT || '1');

/** Sensitivity: 1 at creation, approaches 0 at expiry. Floored at 0.01. */
function engineSensitivity(nowMs, createdAtMs, expiresAtMs) {
  const s = (nowMs - expiresAtMs) / (createdAtMs - expiresAtMs);
  return Math.max(s, 0.01);
}

/** One decay tick: BurnRate = max(1, BurnRate / (2 − C^(BurnRate/S))) */
function engineTickDecay(burnRate, sensitivity, C = ENGINE_C) {
  const decay = 2 - Math.pow(C, burnRate / sensitivity);
  return Math.max(1, burnRate / decay);
}

/** Contribution boost: BurnRate += contribution / goalAmount */
function engineApplyContribution(burnRate, contribution, goalAmount) {
  return burnRate + (goalAmount > 0 ? contribution / goalAmount : 0);
}

// function computeDownloadPricing({
//   basePrice,
//   goalAmount,
//   contributedAmount,
//   actualPostTime,
//   totalDownloads,
//   timeConstant = DOWNLOAD_TIME_DECAY_CONSTANT,
//   sitePopularityConstant = DOWNLOAD_SITE_POPULARITY_CONSTANT,
// }) {
//   const safeBasePrice = Math.max(0, Number(basePrice) || 0);
//   const safeGoalAmount = Math.max(0, Number(goalAmount) || 0);
//   const safeContributedAmount = Math.max(0, Number(contributedAmount) || 0);
//   const safeDownloads = Math.max(0, Number(totalDownloads) || 0);

//   const contributionRatio = safeGoalAmount > 0
//     ? safeContributedAmount / safeGoalAmount
//     : 0;
//   const contributionFactor = Math.pow(Math.max(0, contributionRatio), 0.75);
//   const contributorDiscountPct = Math.max(0, contributionFactor * 100);

//   const daysSincePost = actualPostTime
//     ? Math.max(0, (Date.now() - new Date(actualPostTime).getTime()) / 86_400_000)
//     : 0;

//   const timeDecayFraction = 1 - Math.pow(0.99, Math.max(0, timeConstant) * daysSincePost);
//   const volumeDecayFraction = 1 - Math.pow(0.99, Math.max(0, sitePopularityConstant) * (safeDownloads / 100));

//   let contributorDiscountAmount = safeBasePrice * (contributorDiscountPct / 100);
//   let timeDecayDiscountAmount = safeBasePrice * Math.max(0, timeDecayFraction);
//   let volumeDecayDiscountAmount = safeBasePrice * Math.max(0, volumeDecayFraction);

//   const maxDiscountAmount = safeBasePrice * 0.95;
//   const rawDiscountAmount = contributorDiscountAmount + timeDecayDiscountAmount + volumeDecayDiscountAmount;
//   if (rawDiscountAmount > maxDiscountAmount && rawDiscountAmount > 0) {
//     const scale = maxDiscountAmount / rawDiscountAmount;
//     contributorDiscountAmount *= scale;
//     timeDecayDiscountAmount *= scale;
//     volumeDecayDiscountAmount *= scale;
//   }

//   const finalPrice = safeBasePrice === 0
//     ? 0
//     : Math.max(1, Math.floor(safeBasePrice - (contributorDiscountAmount + timeDecayDiscountAmount + volumeDecayDiscountAmount)));

//   const contributorDiscountPctOut = safeBasePrice > 0 ? (contributorDiscountAmount / safeBasePrice) * 100 : 0;
//   const timeDecayDiscountPct = safeBasePrice > 0 ? (timeDecayDiscountAmount / safeBasePrice) * 100 : 0;
//   const volumeDecayDiscountPct = safeBasePrice > 0 ? (volumeDecayDiscountAmount / safeBasePrice) * 100 : 0;
//   const totalDiscountPct = contributorDiscountPctOut + timeDecayDiscountPct + volumeDecayDiscountPct;

//   return {
//     contributorDiscountPct: +contributorDiscountPctOut.toFixed(2),
//     timeDecayDiscountPct: +timeDecayDiscountPct.toFixed(2),
//     volumeDecayDiscountPct: +volumeDecayDiscountPct.toFixed(2),
//     totalDiscountPct: +totalDiscountPct.toFixed(2),
//     finalPrice,
//   };
// }

// ── Notification helper (pool-based, mirrors notifications table schema) ──
async function createNotif(pool, { userId, type, title, message = '', priority = 'info', category = 'system', relatedPostId = null, actionUrl = null }) {
  const id = Math.random().toString(36).substring(2, 12).toUpperCase();
  const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    await pool.query(
      `INSERT IGNORE INTO notifications (id, userId, type, title, message, priority, category, relatedPostId, actionUrl, isRead, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [id, userId, type, title, message, priority, category, relatedPostId, actionUrl, createdAt]
    );
  } catch (e) {
    console.error('createNotif error:', e.message);
  }
}

const WALLET_TX_ENUM_VALUES = [
  'purchase',
  'credit_purchase',
  'contribution',
  'contribution_refund',
  'contributor_reward',
  'download_payment',
  'creator_earning',
  'creator_payout',
  'admin_adjustment',
  'bonus',
  'stall_purchase',
  'tip',
];

const WALLET_TX_TYPE_FALLBACKS = {
  credit_purchase: 'purchase',
  contribution_refund: 'bonus',
  contributor_reward: 'bonus',
  download_payment: 'contribution',
  creator_earning: 'bonus',
  creator_payout: 'admin_adjustment',
  stall_purchase: 'admin_adjustment',
  tip: 'bonus',
};

async function ensureWalletTransactionTypeCompatibility(db) {
  try {
    const [rows] = await db.query("SHOW COLUMNS FROM walletTransactions LIKE 'type'");
    const typeDef = String(rows?.[0]?.Type || '');
    const missing = WALLET_TX_ENUM_VALUES.filter((value) => !typeDef.includes(`'${value}'`));

    if (!missing.length) return;

    await db.query(`
      ALTER TABLE walletTransactions
      MODIFY COLUMN type ENUM(
        'purchase',
        'credit_purchase',
        'contribution',
        'contribution_refund',
        'contributor_reward',
        'download_payment',
        'creator_earning',
        'creator_payout',
        'admin_adjustment',
        'bonus',
        'stall_purchase',
        'tip'
      ) NOT NULL
    `);

    console.log(`✅ Updated walletTransactions.type enum to include: ${missing.join(', ')}`);
  } catch (err) {
    console.warn('⚠️ walletTransactions schema compatibility check skipped:', err.message || err);
  }
}

async function insertWalletTransaction(db, tx) {
  const insertSql = `INSERT INTO walletTransactions
    (id, userId, type, amount, balanceAfter, relatedPostId, relatedPurchaseId, relatedContributionId, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const id = tx.id || uuidv4();
  const params = [
    id,
    tx.userId,
    tx.type,
    tx.amount,
    tx.balanceAfter,
    tx.relatedPostId || null,
    tx.relatedPurchaseId || null,
    tx.relatedContributionId || null,
    tx.description || null,
  ];

  try {
    await db.query(insertSql, params);
    return { id, typeUsed: tx.type, downgraded: false };
  } catch (err) {
    const isTypeError = err?.code === 'WARN_DATA_TRUNCATED'
      && /column 'type'/i.test(err?.sqlMessage || err?.message || '');
    const fallbackType = WALLET_TX_TYPE_FALLBACKS[tx.type];

    if (!isTypeError || !fallbackType) throw err;

    console.warn(`⚠️ walletTransactions.type "${tx.type}" is not supported by the current DB schema. Falling back to "${fallbackType}".`);
    params[2] = fallbackType;
    await db.query(insertSql, params);
    return { id, typeUsed: fallbackType, downgraded: true };
  }
}

async function ensurePromoSubmissionMetricsColumns(db) {
  try {
    const [cols] = await db.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'promoSubmissions'
         AND COLUMN_NAME IN ('clicks','dislikes','likes','neutrals','impressions','tags')`
    );
    const existing = new Set((cols || []).map((col) => col.COLUMN_NAME));
    const alters = [];
    if (!existing.has('clicks')) alters.push('ADD COLUMN clicks INT DEFAULT 0');
    if (!existing.has('dislikes')) alters.push('ADD COLUMN dislikes INT DEFAULT 0');
    if (!existing.has('likes')) alters.push('ADD COLUMN likes INT DEFAULT 0');
    if (!existing.has('neutrals')) alters.push('ADD COLUMN neutrals INT DEFAULT 0');
    if (!existing.has('impressions')) alters.push('ADD COLUMN impressions INT DEFAULT 0');
    if (!existing.has('tags')) alters.push('ADD COLUMN tags TINYTEXT');

    if (alters.length > 0) {
      await db.query(`ALTER TABLE promoSubmissions ${alters.join(', ')}`);
    }
  } catch (err) {
    // Ignore if table does not yet exist. Explore should stay operational.
    if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146)) return;
    throw err;
  }
}

async function ensureTagInteractionsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tagInteractions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      userId VARCHAR(64) DEFAULT NULL,
      postId VARCHAR(64) DEFAULT NULL,
      tags JSON DEFAULT NULL,
      eventType VARCHAR(32) NOT NULL DEFAULT 'open',
      source VARCHAR(32) DEFAULT 'explore',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_tag_interactions_user_created (userId, created_at),
      KEY idx_tag_interactions_post_created (postId, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function ensurePostReviewsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS postReviews (
      id VARCHAR(36) NOT NULL COMMENT 'UUID',
      postId VARCHAR(36) NOT NULL,
      userId VARCHAR(10) NOT NULL,
      comment TEXT NOT NULL,
      liked TINYINT(1) DEFAULT NULL COMMENT '1=like, 0=dislike, NULL=no vote',
      rating TINYINT UNSIGNED NOT NULL COMMENT '0-100 quality percentage',
      effortRating TINYINT UNSIGNED NOT NULL COMMENT '0-100 quality percentage',
      isEdited TINYINT(1) DEFAULT 0,
      isHidden TINYINT(1) DEFAULT 0 COMMENT 'Hidden by moderator',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY unique_user_post_review (postId, userId) COMMENT 'One review per user per post',
      KEY idx_postId (postId),
      KEY idx_userId (userId),
      KEY idx_qrating (rating),
      KEY idx_erating (effortRating)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function ensurePostFavoritesTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS postFavorites (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      postId VARCHAR(36) NOT NULL,
      userId VARCHAR(10) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY unique_user_post_fav (postId, userId),
      KEY idx_userId (userId)
    ) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function ensurePostTipsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS postTips (
      id VARCHAR(36) NOT NULL,
      postId VARCHAR(36) NOT NULL,
      senderUserId VARCHAR(64) NOT NULL,
      recipientUserId VARCHAR(64) NOT NULL,
      amount INT UNSIGNED NOT NULL,
      message VARCHAR(500) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_post_tips_post (postId),
      KEY idx_post_tips_sender (senderUserId),
      KEY idx_post_tips_recipient (recipientUserId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function ensurePostCommentsSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS postComments (
      id VARCHAR(36) NOT NULL,
      postId VARCHAR(36) NOT NULL,
      userId VARCHAR(64) NOT NULL,
      parentCommentId VARCHAR(36) DEFAULT NULL,
      comment TEXT NOT NULL,
      isDeleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_post_comments_post_created (postId, created_at),
      KEY idx_post_comments_parent (parentCommentId),
      KEY idx_post_comments_user (userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS postCommentReactions (
      id VARCHAR(36) NOT NULL,
      commentId VARCHAR(36) NOT NULL,
      userId VARCHAR(64) NOT NULL,
      reaction ENUM('like', 'dislike') NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_comment_reaction (commentId, userId),
      KEY idx_comment_reactions_comment (commentId),
      KEY idx_comment_reactions_user (userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function ensurePostReactionsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS postReactions (
      id VARCHAR(36) NOT NULL,
      postId VARCHAR(36) NOT NULL,
      userId VARCHAR(64) NOT NULL,
      reaction ENUM('like', 'dislike') NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_post_reaction (postId, userId),
      KEY idx_post_reactions_post (postId),
      KEY idx_post_reactions_user (userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function ensurePostFlagsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS postFlags (
      id VARCHAR(36) NOT NULL,
      postId VARCHAR(36) NOT NULL,
      userId VARCHAR(10) NOT NULL,
      reason ENUM('spam','scam','explicit','abuse','plagiarism','impersonation') NOT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_post_flag_user (postId, userId),
      KEY idx_post_flags_post (postId),
      KEY idx_post_flags_user (userId),
      KEY idx_post_flags_reason (reason)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  // await db.query(`ALTER TABLE postFlags ADD COLUMN IF NOT EXISTS description TEXT NOT NULL AFTER reason`);
}

// ──────────────────────────────────────────────────────────────
module.exports = function prolifer8Routes(server, pool, authenticateToken, PROXY = '', gcs = {}) {
  const { storage, BUCKET_NAME, DEST_PREFIX, publicUrl, getSignedUrl } = gcs;
  const signUrl = getSignedUrl || presignUrl;
  const toPublicUrl = (objectPath) => {
    if (typeof publicUrl === 'function') return publicUrl(BUCKET_NAME, objectPath);
    return null;
  };

  const normalizeObjectKey = (input) => {
    const value = String(input || '');
    if (!value) return '';

    if (/^https?:\/\//i.test(value)) {
      try {
        const parsed = new URL(value);
        const bucketPrefix = `/${BUCKET_NAME}/`;
        if (parsed.pathname.startsWith(bucketPrefix)) {
          return decodeURIComponent(parsed.pathname.slice(bucketPrefix.length));
        }
        return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      } catch {
        return value;
      }
    }

    return value.replace(/^gs:\/\/[^/]+\//, '').replace(/^\/+/, '');
  };

  const buildAbsoluteUrl = (req, routePath) => {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwardedProto || req.protocol;
    return `${protocol}://${req.get('host')}${routePath.startsWith('/') ? routePath : `/${routePath}`}`;
  };

  const resolveThumbnailUrl = (req, postId, thumbnailValue) => {
    const value = String(thumbnailValue || '').trim();
    if (!value) return value;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/uploads/')) return buildAbsoluteUrl(req, value);
    return buildAbsoluteUrl(req, `${PROXY}/api/posts/${postId}/thumbnail`);
  };

  const resolveProfileAssetUrl = (req, value) => {
    const raw = String(value || '').trim();
    if (!raw) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/uploads/')) return buildAbsoluteUrl(req, raw);

    const objectKey = normalizeObjectKey(raw);
    const resolved = toPublicUrl(objectKey);
    return resolved || raw;
  };

  const resolvePromoAssetUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;

    const objectKey = normalizeObjectKey(raw);
    const resolved = objectKey ? toPublicUrl(objectKey) : null;
    return resolved || raw;
  };

  const serializePost = (req, post) => {
    if (!post) return post;
    return {
      ...post,
      thumbnailUrl: resolveThumbnailUrl(req, post.id, post.thumbnailUrl),
    };
  };

  const serializePosts = (req, posts) => (posts || []).map((post) => serializePost(req, post));

  ensureWalletTransactionTypeCompatibility(pool).catch(() => { });
  ensurePostReviewsTable(pool).catch((err) => {
    console.warn('⚠️ Failed to ensure postReviews table:', err.message || err);
  });
  ensurePostFavoritesTable(pool).catch((err) => {
    console.warn('⚠️ Failed to ensure postFavorites table:', err.message || err);
  });
  ensurePostTipsTable(pool).catch((err) => {
    console.warn('⚠️ Failed to ensure postTips table:', err.message || err);
  });
  ensureTagInteractionsTable(pool).catch((err) => {
    console.warn('⚠️ Failed to ensure tagInteractions table:', err.message || err);
  });
  ensurePostCommentsSchema(pool).catch((err) => {
    console.warn('⚠️ Failed to ensure post comments schema:', err.message || err);
  });
  ensurePostReactionsTable(pool).catch((err) => {
    console.warn('⚠️ Failed to ensure post reactions table:', err.message || err);
  });
  ensurePostFlagsTable(pool).catch((err) => {
    console.warn('⚠️ Failed to ensure post flags table:', err.message || err);
  });

  // ============================================================
  //  POSTS — CRUD
  // ============================================================

  /**
   * GET /api/posts
   * List posts with optional filters.
   * Query params: status, tag, search, sort (newest|popular|ending|burnRate), page, limit
   */
  server.get(PROXY + '/api/posts', async (req, res) => {
    try {
      const { status, tag, search, sort = 'newest', page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, +page) - 1) * Math.min(50, +limit || 20);
      const cap = Math.min(50, +limit || 20);

      let where = 'WHERE d.isPublic = 1';
      const params = [];

      if (status) {
        where += ' AND d.status = ?';
        params.push(status);
      }
      if (tag) {
        where += ' AND JSON_CONTAINS(d.tags, ?)';
        params.push(JSON.stringify(tag));
      }
      if (search) {
        where += ' AND (d.title LIKE ? OR d.description LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s);
      }

      const orderMap = {
        newest: 'd.created_at DESC',
        // popular: 'd.contributorCount DESC',
        // ending: 'd.scheduledPostTime ASC',
        views: 'd.views DESC',
      };
      const order = orderMap[sort] || orderMap.newest;

      const [rows] = await pool.query(
        `SELECT d.*, u.username AS creatorName, u.profilePicture AS creatorAvatar,
                (SELECT COUNT(*) FROM postFlags pf WHERE pf.postId = d.id) AS flagCount
         FROM posts d
         JOIN userData u ON u.id = d.creatorId
         ${where}
         ORDER BY ${order}
         LIMIT ? OFFSET ?`,
        [...params, cap, offset]
      );

      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM posts d ${where}`,
        params
      );

      res.json({ posts: serializePosts(req, rows), total, page: +page, limit: cap });
    } catch (err) {
      console.error('GET /api/posts error:', err);
      res.status(500).json({ error: 'Failed to fetch posts' });
    }
  });

  /**
   * GET /api/posts/featured
   * Returns featured, sponsored, and trending sections for the Explore page.
   */
  server.get(PROXY + '/api/posts/featured', async (req, res) => {
    try {
      const [featured] = await pool.query(
        `SELECT d.*, u.username AS creatorName, u.profilePicture AS creatorAvatar
         FROM posts d JOIN userData u ON u.id = d.creatorId
         WHERE d.status IN ('active','pending') AND d.isPublic = 1
         ORDER BY d.burnRate DESC LIMIT 4`
      );

      const [trending] = await pool.query(
        `SELECT d.*, u.username AS creatorName, u.profilePicture AS creatorAvatar
         FROM posts d JOIN userData u ON u.id = d.creatorId
         WHERE d.status IN ('active','pending') AND d.isPublic = 1
         ORDER BY d.momentum DESC LIMIT 3`
      );

      const [newest] = await pool.query(
        `SELECT d.*, u.username AS creatorName, u.profilePicture AS creatorAvatar
         FROM posts d JOIN userData u ON u.id = d.creatorId
         WHERE d.status IN ('active','pending','posted') AND d.isPublic = 1
         ORDER BY d.created_at DESC LIMIT 4`
      );

      const [topCreators] = await pool.query(
        `SELECT id, username, profilePicture, bio, creatorRating, totalPostsCreated, totalCreditsEarned
         FROM userData
         WHERE accountPlan = 'creator' AND totalPostsCreated > 0
         ORDER BY creatorRating DESC LIMIT 4`
      );

      res.json({
        featured: serializePosts(req, featured),
        trending: serializePosts(req, trending),
        newest: serializePosts(req, newest),
        topCreators,
      });
    } catch (err) {
      console.error('GET /api/posts/featured error:', err);
      res.status(500).json({ error: 'Failed to fetch featured posts' });
    }
  });

  /**
   * GET /api/promotions/sponsored
   * Returns approved sponsored promos for the Explore page.
   */
  server.get(PROXY + '/api/promotions/sponsored', async (req, res) => {
    try {
      await ensurePromoSubmissionMetricsColumns(pool);
      const limit = Math.min(20, Math.max(1, Number(req.query.limit || 6)));
      const tag = String(req.query.tag || '').trim();
      const hasTag = !!tag;
      const [rows] = await pool.query(
        `SELECT id, userId, username, submissionType, mediaType, title, description,
          targetPostId, target_url, mediaUrl, ctaText, budgetCredits, assetPath,
          thumbnailImg, thumbnailImg AS thumbnailPath, status,
                clicks, impressions, likes, neutrals, dislikes, tags,
                created_at, updated_at
         FROM promoSubmissions
         WHERE status = 'approved'
           AND (
             (submissionType = 'post_sponsorship' AND targetPostId IS NOT NULL AND targetPostId <> '')
             OR (submissionType = 'ad' AND target_url IS NOT NULL AND target_url <> '')
           )
           ${hasTag ? 'AND tags IS NOT NULL AND LOWER(tags) LIKE LOWER(?)' : ''}
         ORDER BY updated_at DESC
         LIMIT ?`,
        hasTag ? [`%${tag}%`, limit] : [limit]
      );

      const sponsored = rows.map((row) => {
        const resolvedThumbnail = resolvePromoAssetUrl(row.thumbnailImg || row.thumbnailPath || '');
        return {
          ...row,
          assetPath: resolvePromoAssetUrl(row.assetPath),
          mediaUrl: resolvePromoAssetUrl(row.mediaUrl),
          thumbnailImg: resolvedThumbnail,
          thumbnailPath: resolvedThumbnail,
        };
      });

      res.json({ sponsored });
    } catch (err) {
      // If promoSubmissions does not exist yet, return an empty list instead of failing Explore.
      if (err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146)) {
        return res.json({ sponsored: [] });
      }
      console.error('GET /api/promotions/sponsored error:', err);
      res.status(500).json({ error: 'Failed to fetch sponsored promotions' });
    }
  });

  server.post(PROXY + '/api/promotions/:id/impression', async (req, res) => {
    try {
      await ensurePromoSubmissionMetricsColumns(pool);
      const id = String(req.params.id || '');
      const [result] = await pool.query(
        `UPDATE promoSubmissions
         SET impressions = COALESCE(impressions, 0) + 1
         WHERE id = ? AND status = 'approved'`,
        [id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'Promo not found' });
      res.json({ success: true });
    } catch (err) {
      console.error('POST /api/promotions/:id/impression error:', err);
      res.status(500).json({ error: 'Failed to track impression' });
    }
  });

  server.post(PROXY + '/api/promotions/:id/click', async (req, res) => {
    try {
      await ensurePromoSubmissionMetricsColumns(pool);
      const id = String(req.params.id || '');
      const [result] = await pool.query(
        `UPDATE promoSubmissions
         SET clicks = COALESCE(clicks, 0) + 1
         WHERE id = ? AND status = 'approved'`,
        [id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'Promo not found' });
      res.json({ success: true });
    } catch (err) {
      console.error('POST /api/promotions/:id/click error:', err);
      res.status(500).json({ error: 'Failed to track click' });
    }
  });

  server.post(PROXY + '/api/promotions/:id/reaction', async (req, res) => {
    try {
      await ensurePromoSubmissionMetricsColumns(pool);
      const id = String(req.params.id || '');
      const reaction = String(req.body?.reaction || '').toLowerCase();
      const columnByReaction = {
        like: 'likes',
        neutral: 'neutrals',
        dislike: 'dislikes',
      };
      const col = columnByReaction[reaction];
      if (!col) return res.status(400).json({ error: 'reaction must be like, neutral, or dislike' });

      const [result] = await pool.query(
        `UPDATE promoSubmissions
         SET ${col} = COALESCE(${col}, 0) + 1
         WHERE id = ? AND status = 'approved'`,
        [id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'Promo not found' });
      res.json({ success: true, reaction });
    } catch (err) {
      console.error('POST /api/promotions/:id/reaction error:', err);
      res.status(500).json({ error: 'Failed to track reaction' });
    }
  });

  /**
   * GET /api/posts/:id
   * Single post with creator info.
   */
  server.get(PROXY + '/api/posts/:id', async (req, res) => {
    try {
      // Knex returns an array of records directly. .first() ensures we get one object.
      const row = await knex('posts as d')
        .join('userData as u', 'u.id', 'd.creatorId')
        .select(
          'd.*',
          'u.username as creatorName',
          'u.profilePicture as creatorAvatar',
          knex.raw('(SELECT COUNT(*) FROM postFlags pf WHERE pf.postId = d.id) as flagCount')
        )
        .where('d.id', req.params.id)
        .first();

      if (!row) return res.status(404).json({ error: 'Post not found' });
      res.json(serializePost(req, row));
    } catch (err) {
      console.error('GET /api/posts/:id error:', err);
      res.status(500).json({ error: 'Failed to fetch post' });
    }
  });

  /**
   * GET /api/posts/:id/reaction
   * Returns the authenticated user's reaction for a post.
   */
  server.get(PROXY + '/api/posts/:id/reaction', authenticateToken, async (req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT reaction FROM postReactions WHERE postId = ? AND userId = ?',
        [req.params.id, req.user.id]
      );
      res.json({ reaction: rows[0]?.reaction || null });
    } catch (err) {
      console.error('GET /api/posts/:id/reaction error:', err);
      res.status(500).json({ error: 'Failed to fetch reaction' });
    }
  });

  /**
   * POST /api/posts/:id/view
   * Increment and return post views.
   */
  server.post(PROXY + '/api/posts/:id/view', async (req, res) => {
    try {
      const postId = req.params.id;
      const [viewColRows] = await pool.query("SHOW COLUMNS FROM posts LIKE 'views'");
      const [viewCountColRows] = await pool.query("SHOW COLUMNS FROM posts LIKE 'viewCount'");

      const viewColumn = viewColRows.length ? 'views' : (viewCountColRows.length ? 'viewCount' : null);
      if (!viewColumn) {
        return res.status(500).json({ error: 'No view counter column found on posts table' });
      }

      const [updateResult] = await pool.query(
        `UPDATE posts SET ${viewColumn} = COALESCE(${viewColumn}, 0) + 1 WHERE id = ?`,
        [postId]
      );
      if (!updateResult.affectedRows) return res.status(404).json({ error: 'Post not found' });

      const [[row]] = await pool.query(
        `SELECT COALESCE(${viewColumn}, 0) AS views FROM posts WHERE id = ?`,
        [postId]
      );
      if (!row) return res.status(404).json({ error: 'Post not found' });
      res.json({ views: Number(row.views) || 0 });
    } catch (err) {
      console.error('POST /api/posts/:id/view error:', err);
      res.status(500).json({ error: 'Failed to count view' });
    }
  });

  /**
   * POST /api/posts
   * Create a new post. Requires authentication.
   */
  server.post(PROXY + '/api/posts', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        title,
        description,
        fileType,
        tags,
        trailerUrl,
        thumbnailUrl,
        mature,
        link,
        linkUrl,
        externalUrl,
      } = req.body;

      if (!title && !(tags?.length > 0)) {
        return res.status(400).json({ error: 'Missing required fields: title' });
      }

      // In your raw query, you had 14 columns but only 8 values. 
      // Knex handles this perfectly by mapping explicitly to a key-value object.
      const postId = uuidv4();
      const resolvedLink = String(link || linkUrl || externalUrl || '').trim() || null;
      const normalizedFileType = fileType || 'other';
      await knex('posts').insert({
        id: postId,
        creatorId: userId,
        title,
        description: description || '',
        fileType: normalizedFileType,
        tags: JSON.stringify(tags || []),
        trailerUrl: trailerUrl || null,
        thumbnailUrl: thumbnailUrl ? normalizeObjectKey(thumbnailUrl) : null,
        link: normalizedFileType === 'link' ? resolvedLink : null,
        mature: Boolean(mature),
        status: 'draft'
      });

      // Upgrade user to creator if needed using Knex increment
      await knex('userData')
        .where({ id: userId, accountPlan: 'free' })
        .increment('totalPostsCreated', 1);

      res.status(201).json({ id: postId, message: 'Post created' });
    } catch (err) {
      console.error('POST /api/posts error:', err);
      res.status(500).json({ error: 'Failed to create post' });
    }
  });

  /**
   * PUT /api/posts/:id
   * Update a post (creator only, draft/pending only).
   */
  server.put(PROXY + '/api/posts/:id', authenticateToken, async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;

      // fetch old thumbnail too
      const post = await knex('posts')
        .select('creatorId', 'status', 'thumbnailUrl')
        .where('id', postId)
        .first();

      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.creatorId !== userId) return res.status(403).json({ error: 'Not the creator' });
      if (!['draft', 'pending'].includes(post.status)) {
        return res.status(400).json({ error: 'Can only edit draft or pending posts' });
      }

      // Replaced your dynamic string construction loop with a standard clean object approach
      const allowed = [
        'title', 'description', 'fileType', 'trailerUrl', 'thumbnailUrl', 'mature',
        'status', 'isPublic', 'link'
      ];
      const updateData = {};

      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          updateData[key] = req.body[key];
        }
      }

      // Explicitly check and format special database fields
      if (req.body.tags !== undefined) {
        updateData.tags = JSON.stringify(req.body.tags);
      }
      if (req.body.linkUrl !== undefined && req.body.link === undefined) {
        updateData.link = req.body.linkUrl;
      }
      if (req.body.externalUrl !== undefined && req.body.link === undefined && req.body.linkUrl === undefined) {
        updateData.link = req.body.externalUrl;
      }
      if (updateData.link !== undefined) {
        updateData.link = String(updateData.link || '').trim() || null;
      }
      if (req.body.fileType === 'link' && updateData.link === undefined) {
        updateData.link = String(req.body.link || req.body.linkUrl || req.body.externalUrl || '').trim() || null;
      }
      if (req.body.fileType && req.body.fileType !== 'link' && req.body.link === undefined && req.body.linkUrl === undefined && req.body.externalUrl === undefined) {
        updateData.link = null;
      }
      if (req.body.thumbnailUrl !== undefined) {
        updateData.thumbnailUrl = req.body.thumbnailUrl ? normalizeObjectKey(req.body.thumbnailUrl) : null;
      }
      // if (req.body.scheduledPostTime !== undefined) {
      //   updateData.scheduledPostTime = new Date(req.body.scheduledPostTime);
      // }
      // if (req.body.expiresAt !== undefined) {
      //   updateData.expiresAt = new Date(req.body.expiresAt);
      // }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'Nothing to update' });
      }


      if (req.body.thumbnailKey !== undefined) {
        const oldThumb = post.thumbnailUrl;
        updateData.thumbnailUrl = req.body.thumbnailKey ? normalizeObjectKey(req.body.thumbnailKey) : null;

        // delete the old object from R2 (best-effort; don't fail the request)
        if (oldThumb && oldThumb !== updateData.thumbnailUrl) {
          try {
            const oldKey = normalizeObjectKey(oldThumb);
            await storage.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: oldKey }));
          } catch (delErr) {
            console.warn('Failed to delete old thumbnail:', delErr.message);
          }
        }
      }

      await knex('posts').where('id', postId).update(updateData);
      res.json({ message: 'Post updated' });
    } catch (err) {
      console.error('PUT /api/posts/:id error:', err);
      res.status(500).json({ error: 'Failed to update post' });
    }
  });

  /**
   * POST /api/posts/:id/publish
   * Move draft → pending (makes it visible, waiting for spark goal).
   */
  server.post(PROXY + '/api/posts/:id/publish', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;

      const post = await knex('posts')
        .select('creatorId', 'status', 'title')
        .where('id', req.params.id)
        .first();

      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.creatorId !== userId) return res.status(403).json({ error: 'Not the creator' });
      if (post.status !== 'draft') return res.status(400).json({ error: 'Only draft posts can be published' });

      await knex('posts').where('id', req.params.id).update({ status: 'pending' });
      res.json({ message: `"${post.title}" is now live and awaiting contributions` });
    } catch (err) {
      console.error('POST /api/posts/:id/publish error:', err);
      res.status(500).json({ error: 'Failed to publish post' });
    }
  });

  /**
   * DELETE /api/posts/:id
   * Hard-delete a post + GCS files (creator only).
   */
  server.delete(PROXY + '/api/posts/:id', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const postId = req.params.id;

      const post = await knex('posts')
        .select('creatorId', 'filePath', 'thumbnailUrl')
        .where('id', postId)
        .first();
      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.creatorId !== userId) return res.status(403).json({ error: 'Not the creator' });

      // Delete files from object storage (best-effort)
      if (storage && BUCKET_NAME) {
        const filesToDelete = [post.filePath, post.thumbnailUrl].filter(Boolean);
        await Promise.allSettled(
          filesToDelete.map(async (filePath) => {
            try {
              const key = normalizeObjectKey(filePath);
              await storage.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
            } catch (e) {
              console.warn(`Storage delete skipped for ${filePath}:`, e.message);
            }
          })
        );
      }

      await knex('posts').where('id', postId).delete();
      res.json({ message: 'Post deleted' });
    } catch (err) {
      console.error('DELETE /api/posts/:id error:', err);
      res.status(500).json({ error: 'Failed to delete post' });
    }
  });

  /**
   * PATCH /api/posts/:id/visibility
   * Toggle hidden ↔ previous public status (creator only).
   */
  server.patch(PROXY + '/api/posts/:id/visibility', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const postId = req.params.id;

      const post = await knex('posts').select('creatorId', 'status').where('id', postId).first();
      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.creatorId !== userId) return res.status(403).json({ error: 'Not the creator' });

      const isHidden = post.status === 'hidden';
      // When unhiding we restore to 'active'; adjust as needed per your business logic
      const newStatus = isHidden ? 'active' : 'hidden';
      await knex('posts').where('id', postId).update({ status: newStatus });
      res.json({ status: newStatus });
    } catch (err) {
      console.error('PATCH /api/posts/:id/visibility error:', err);
      res.status(500).json({ error: 'Failed to toggle visibility' });
    }
  });

  /**
   * POST /api/posts/:id/duplicate
   * Create a draft copy of a post (creator only).
   */
  server.post(PROXY + '/api/posts/:id/duplicate', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const postId = req.params.id;

      const post = await knex('posts').where('id', postId).first();
      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.creatorId !== userId) return res.status(403).json({ error: 'Not the creator' });

      const newId = uuidv4();
      await knex('posts').insert({
        ...post,
        id: newId,
        title: `${post.title} (copy)`,
        status: 'draft',
        isPublic: 0,
        currentContributions: 0,
        contributorCount: 0,
        totalDownloads: 0,
        totalRevenue: 0,
        views: 0,
        likeCount: 0,
        dislikeCount: 0,
        reviewCount: 0,
        avgRating: null,
        momentum: 0,
        burnRate: 1,
        actualPostTime: null,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });

      res.status(201).json({ id: newId, message: 'Post duplicated as draft' });
    } catch (err) {
      console.error('POST /api/posts/:id/duplicate error:', err);
      res.status(500).json({ error: 'Failed to duplicate post' });
    }
  });

  /**
   * POST /api/posts/:id/boost
   * Start a credit boost for a post (creator only).
   * Body: { budget: number, durationHours?: number, maxImpressions?: number, priorityProbability?: number }
   */
  server.post(PROXY + '/api/posts/:id/boost', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const postId = req.params.id;
      const { budget, durationHours = null, maxImpressions = null, priorityProbability = 0.3 } = req.body;

      if (!budget || Number(budget) < 500) {
        return res.status(400).json({ error: 'Minimum budget is 500 credits' });
      }

      const post = await knex('posts').select('creatorId', 'status', 'fileType', 'mediaDuration').where('id', postId).first();
      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.creatorId !== userId) return res.status(403).json({ error: 'Not the creator' });

      // Deduct credits from creator
      const [[userRow]] = await pool.query('SELECT credits FROM userData WHERE id = ?', [userId]);
      if (!userRow) return res.status(404).json({ error: 'User not found' });
      if (Number(userRow.credits) < Number(budget)) {
        return res.status(400).json({ error: 'Insufficient credits' });
      }

      const bc = parseFloat(process.env.BOOST_BC || '2');
      const costPerHour = parseFloat(process.env.BOOST_COST_PER_HOUR || '2');
      const mediaDuration = Number(post.mediaDuration || 0);
      const p = Math.min(0.5, Math.max(0.1, Number(priorityProbability) || 0.3));
      const isRichMedia = ['video', 'music'].includes(post.fileType);
      const baseCostPerView = isRichMedia
        ? Math.round(bc + 5 * (1 + mediaDuration / 60))
        : Math.round(bc);
      const costPerView = Math.max(1, Math.round(baseCostPerView * (0.7 + p)));

      const endsAt = durationHours
        ? new Date(Date.now() + durationHours * 60 * 60 * 1000)
        : null;

      // End any existing active campaign for this post before creating a new one.
      await pool.query(
        `UPDATE postBoosts SET status = 'cancelled'
         WHERE postId = ? AND status = 'active'`,
        [postId]
      );

      const boostId = uuidv4();
      await pool.query(
        `INSERT INTO postBoosts
         (id, postId, userId, budget, remainingBudget, campaignBalance, campaignSpent, costPerView, costPerHour,
          maxImpressions, impressionCount, durationHours, endsAt, priorityProbability, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, 'active', NOW())`,
        [
          boostId,
          postId,
          userId,
          Number(budget),
          Number(budget),
          Number(budget),
          costPerView,
          costPerHour,
          maxImpressions,
          durationHours,
          endsAt,
          p,
        ]
      );

      await pool.query(
        `INSERT INTO boostCampaignBalances
         (id, boostId, postId, userId, initialBalance, currentBalance, totalSpent, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'active', NOW())`,
        [uuidv4(), boostId, postId, userId, Number(budget), Number(budget)]
      );

      // Deduct budget once from wallet and move into campaign balance bucket.
      const newBalance = Number(userRow.credits) - Number(budget);
      await pool.query('UPDATE userData SET credits = ? WHERE id = ?', [newBalance, userId]);
      await insertWalletTransaction(pool, {
        userId,
        type: 'admin_adjustment',
        amount: -Number(budget),
        balanceAfter: newBalance,
        relatedPostId: postId,
        description: `Boost campaign pre-allocation for post ${postId}`,
      });

      // Mark post as boosted
      await knex('posts').where('id', postId).update({ status: 'boosted' });

      res.status(201).json({
        boostId,
        message: 'Boost started',
        campaignBalance: Number(budget),
        costPerView,
        costPerHour,
      });
    } catch (err) {
      console.error('POST /api/posts/:id/boost error:', err);
      res.status(500).json({ error: 'Failed to start boost' });
    }
  });

  /**
   * GET /api/boosts/config
   * Returns current baseline cost (BC) used for boost pricing.
   */
  server.get(PROXY + '/api/boosts/config', async (_req, res) => {
    res.json({ bc: parseFloat(process.env.BOOST_BC || '4') });
  });

  /**
   * POST /api/posts/:id/boost-view
    * Called when a user watches a boosted post. Deducts cost from campaign balance,
   * rewards watcher with 50% back.
   */
  server.post(PROXY + '/api/posts/:id/boost-view', authenticateToken, async (req, res) => {
    try {
      const watcherId = req.user.id;
      const postId = req.params.id;

      // Find active boost for this post
      const [[boost]] = await pool.query(
        `SELECT b.id, b.userId AS creatorId, b.costPerView, cb.currentBalance AS campaignBalance
         FROM postBoosts b
         JOIN boostCampaignBalances cb ON cb.boostId = b.id AND cb.status = 'active'
         WHERE b.postId = ? AND b.status = 'active' AND cb.currentBalance >= b.costPerView
         LIMIT 1`,
        [postId]
      );
      if (!boost) return res.json({ credited: 0 }); // no active boost — silent

      const cpv = Number(boost.costPerView);
      const watcherReward = Math.floor(cpv / 2);

      // Deduct from boost budget
      await pool.query(
        `UPDATE postBoosts
         SET campaignBalance = campaignBalance - ?,
             remainingBudget = GREATEST(0, remainingBudget - ?),
             campaignSpent = campaignSpent + ?,
             impressionCount  = impressionCount + 1
         WHERE id = ?`,
        [cpv, cpv, cpv, boost.id]
      );
      await pool.query(
        `UPDATE boostCampaignBalances
         SET currentBalance = currentBalance - ?,
             totalSpent = totalSpent + ?
         WHERE boostId = ? AND status = 'active'`,
        [cpv, cpv, boost.id]
      );

      // Credit watcher
      const [[watcherRow]] = await pool.query('SELECT creditBalance FROM userData WHERE id = ?', [watcherId]);
      if (watcherRow && watcherReward > 0) {
        const newBal = Number(watcherRow.creditBalance) + watcherReward;
        await pool.query('UPDATE userData SET creditBalance = ? WHERE id = ?', [newBal, watcherId]);
        await insertWalletTransaction(pool, {
          userId: watcherId,
          type: 'bonus',
          amount: watcherReward,
          balanceAfter: newBal,
          relatedPostId: postId,
          description: `Boost view reward from post ${postId}`,
        });
      }

      // Auto-stop boost if budget exhausted
      await pool.query(
        `UPDATE postBoosts SET status = 'completed'
         WHERE id = ? AND campaignBalance < costPerView`,
        [boost.id]
      );
      await pool.query(
        `UPDATE boostCampaignBalances cb
         JOIN postBoosts b ON b.id = cb.boostId
         SET cb.status = 'completed'
         WHERE b.id = ? AND b.status = 'completed'`,
        [boost.id]
      );
      // Check if no more active boosts for the post → revert to active
      const [[{ cnt }]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM postBoosts WHERE postId = ? AND status = 'active'`,
        [postId]
      );
      if (Number(cnt) === 0) {
        await knex('posts').where('id', postId).where('status', 'boosted').update({ status: 'active' });
      }

      res.json({ credited: watcherReward });
    } catch (err) {
      console.error('POST /api/posts/:id/boost-view error:', err);
      res.status(500).json({ error: 'Failed to record boost view' });
    }
  });

  /**
   * GET /api/posts/:id
   * Single post with creator info.
   */
  server.get(PROXY + '/api/posts/:id', async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT d.*, u.username AS creatorName, u.profilePicture AS creatorAvatar,
                (SELECT COUNT(*) FROM postFlags pf WHERE pf.postId = d.id) AS flagCount
         FROM posts d
         JOIN userData u ON u.id = d.creatorId
         WHERE d.id = ?`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Post not found' });
      res.json(serializePost(req, rows[0]));
    } catch (err) {
      console.error('GET /api/posts/:id error:', err);
      res.status(500).json({ error: 'Failed to fetch post' });
    }
  });

  /**
 * POST /api/posts
 * Create a new post. Requires authentication.
 * Body: title, description, fileType, tags[], trailerUrl?, thumbnailUrl?
 * File upload is handled separately via /api/posts/:id/upload-url + /confirm-upload.
 */
  server.post(PROXY + '/api/posts', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;

      // Removed all unused fields from extraction
      const {
        title, description, fileType, tags,
        trailerUrl, thumbnailUrl
      } = req.body;

      if (!title && !(tags?.length > 0)) {
        return res.status(400).json({ error: 'Missing required fields: title' });
      }

      const postId = uuidv4();
      await pool.query(
        `INSERT INTO posts
         (id, creatorId, title, description, fileType, tags,
          
          trailerUrl, thumbnailUrl, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
        [
          postId,
          userId,
          title,
          description || '',
          fileType || 'other',
          JSON.stringify(tags || []),
          trailerUrl || null,
          thumbnailUrl || null,
        ]
      );

      // Upgrade user to creator if needed
      await pool.query(
        `UPDATE userData SET totalPostsCreated = totalPostsCreated + 1 WHERE id = ? AND accountPlan = 'free'`,
        [userId]
      );

      res.status(201).json({ id: postId, message: 'Post created' });
    } catch (err) {
      console.error('POST /api/posts error:', err);
      res.status(500).json({ error: 'Failed to create post' });
    }
  });






  // ============================================================
  //  DOWNLOADS — Post-release file purchases
  // ============================================================

  /**
   * GET /api/posts/:id/price-preview
   * Returns dynamic price breakdown. Optionally authenticated for contributor discount.
   * Must be defined BEFORE the generic /:id routes to avoid collision.
   */
  server.get(PROXY + '/api/posts/:id/price-preview', async (req, res) => {
    try {
      const postId = req.params.id;
      // Soft auth — not required
      let userId = null;
      try {
        const hdr = req.headers.authorization;
        if (hdr) {
          const jwt = require('jsonwebtoken');
          const payload = jwt.verify(hdr.split(' ')[1], process.env.JWT_SECRET || 'secret');
          userId = payload.id || payload.userId || null;
        }
      } catch (_) { }

      const [[post]] = await pool.query(
        `SELECT id, creatorId, basePrice, goalAmount, actualPostTime, totalDownloads,
                status
         FROM posts WHERE id = ?`,
        [postId]
      );
      if (!post) return res.status(404).json({ error: 'Post not found' });

      let contributedAmount = 0;
      const isCreator = userId != null && userId === post.creatorId;

      if (userId) {
        const [[c]] = await pool.query(
          `SELECT COALESCE(SUM(amount),0) AS contributed FROM contributions WHERE postId = ? AND userId = ? AND isRefunded = 0`,
          [postId, userId]
        );
        contributedAmount = Number(c.contributed) || 0;
      }

      // Calculate preview for users who haven't downloaded yet
      const basePrice = post.basePrice;
      const pricing = computeDownloadPricing({
        basePrice,
        goalAmount: post.goalAmount,
        contributedAmount,
        actualPostTime: post.actualPostTime,
        totalDownloads: post.totalDownloads,
      });
      const finalPrice = isCreator ? 0 : pricing.finalPrice;

      res.json({
        basePrice,
        contributedAmount,
        contributorDiscountPct: pricing.contributorDiscountPct,
        timeDecayDiscountPct: pricing.timeDecayDiscountPct,
        volumeDecayDiscountPct: pricing.volumeDecayDiscountPct,
        totalDiscountPct: pricing.totalDiscountPct,
        finalPrice,
        isCreator,
        isFree: isCreator || basePrice === 0,
      });
    } catch (err) {
      console.error('GET /api/posts/:id/price-preview error:', err);
      res.status(500).json({ error: 'Failed to compute price' });
    }
  });

  /**
   * GET /api/posts/:id/download-url
   * Returns a 1h signed GCS URL for users who have purchased the post.
   */
  server.get(PROXY + '/api/posts/:id/download-url', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const postId = req.params.id;

      const [[post]] = await pool.query(
        `SELECT creatorId, filePath, originalFileName, status FROM posts WHERE id = ?`, [postId]
      );
      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.status !== 'posted') return res.status(400).json({ error: 'Post not yet released' });
      if (!post.filePath) return res.status(404).json({ error: 'No file attached to this post yet' });

      if (!storage) return res.status(503).json({ error: 'Cloud storage not configured' });

      const signedUrl = await signUrl(
        storage,
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: normalizeObjectKey(post.filePath),
          ResponseContentDisposition: `attachment; filename="${post.originalFileName || 'download'}"`,
        }),
        { expiresIn: 5 * 60 }
      );

      res.json({ url: signedUrl, filename: post.originalFileName || 'download' });
    } catch (err) {
      console.error('GET /api/posts/:id/download-url error:', err);
      res.status(500).json({ error: 'Failed to generate download URL' });
    }
  });

  /**
   * GET /api/posts/:id/file-url
   * Returns a short-lived signed URL for inline viewing of posted post files.
   */
  server.get(PROXY + '/api/posts/:id/file-url', async (req, res) => {
    try {
      const postId = req.params.id;
      const [[post]] = await pool.query(
        `SELECT id, status, filePath, originalFileName, mimeType FROM posts WHERE id = ?`,
        [postId]
      );

      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.status === 'removed') return res.status(403).json({ error: 'Post file not publicly available' });
      if (!post.filePath) return res.status(404).json({ error: 'No file attached to this post yet' });

      if (/^https?:\/\//i.test(post.filePath)) {
        return res.json({
          fileUrl: post.filePath,
          mimeType: post.mimeType || null,
          originalFileName: post.originalFileName || null,
        });
      }

      const objectPath = normalizeObjectKey(post.filePath);
      const publicAssetUrl = BUCKET_NAME ? toPublicUrl(objectPath) : null;

      if (!storage) {
        if (!publicAssetUrl) return res.status(503).json({ error: 'Cloud storage not configured' });
        return res.json({
          fileUrl: publicAssetUrl,
          mimeType: post.mimeType || null,
          originalFileName: post.originalFileName || null,
        });
      }

      try {
        const signedUrl = await signUrl(
          storage,
          new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: objectPath,
            ResponseContentDisposition: 'inline',
          }),
          { expiresIn: 5 * 60 }
        );

        return res.json({
          fileUrl: signedUrl,
          mimeType: post.mimeType || null,
          originalFileName: post.originalFileName || null,
        });
      } catch (signErr) {
        if (!publicAssetUrl) throw signErr;
        return res.json({
          fileUrl: publicAssetUrl,
          mimeType: post.mimeType || null,
          originalFileName: post.originalFileName || null,
        });
      }
    } catch (err) {
      console.error('GET /api/posts/:id/file-url error:', err);
      res.status(500).json({ error: 'Failed to generate file URL' });
    }
  });

  /**
   * POST /api/posts/:id/download
   * Purchase and get download URL. Handles contributor discounts + decay pricing.
   */
  server.post(PROXY + '/api/posts/:id/download', authenticateToken, async (req, res) => {
    try {
      const postId = req.params.id;
      const [[post]] = await pool.query('SELECT filePath, originalFileName, status FROM posts WHERE id = ?', [postId]);
      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.status !== 'posted') return res.status(400).json({ error: 'Post not yet released' });
      if (!post.filePath) return res.status(404).json({ error: 'No file attached to this post yet' });

      if (!storage) return res.status(503).json({ error: 'Cloud storage not configured' });

      const signedUrl = await signUrl(
        storage,
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: normalizeObjectKey(post.filePath),
          ResponseContentDisposition: `attachment; filename="${post.originalFileName || 'download'}"`,
        }),
        { expiresIn: 60 * 60 }
      );

      res.json({ url: signedUrl, filename: post.originalFileName || 'download' });
    } catch (err) {
      console.error('POST /api/posts/:id/download error:', err);
      res.status(500).json({ error: 'Download failed' });
    }
  });


  // ============================================================
  //  REVIEWS
  // ============================================================

  /**
   * GET /api/posts/:id/reviews
   */
  server.get(PROXY + '/api/posts/:id/reviews', async (req, res) => {
    try {
      const { sort = 'newest' } = req.query;
      const order = sort === 'top' ? 'r.rating DESC' : 'r.created_at DESC';
      const [rows] = await pool.query(
        `SELECT r.*, u.username, u.profilePicture AS avatar
         FROM postReviews r
         JOIN userData u ON u.id = r.userId
         WHERE r.postId = ? AND r.isHidden = 0
         ORDER BY ${order}
         LIMIT 50`,
        [req.params.id]
      );
      res.json(serializePosts(req, rows));
    } catch (err) {
      console.error('GET /api/posts/:id/reviews error:', err);
      res.status(500).json({ error: 'Failed to fetch reviews' });
    }
  });

  /**
   * POST /api/posts/:id/reviews
   * Body: { comment, rating (0-100), liked (true/false/null) }
   */
  server.post(PROXY + '/api/posts/:id/reviews', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const postId = req.params.id;
      const { comment, rating, liked, effortRating } = req.body;

      if (!comment || rating === undefined) {
        return res.status(400).json({ error: 'comment and rating required' });
      }
      const clampedRating = Math.max(0, Math.min(100, Math.floor(+rating)));
      const clampedEffortRating =
        effortRating === undefined || effortRating === null
          ? null
          : Math.max(0, Math.min(100, Math.floor(+effortRating)));

      const reviewId = uuidv4();
      await pool.query(
        `INSERT INTO postReviews (id, postId, userId, comment, rating, effortRating, liked)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           comment = VALUES(comment),
           rating = VALUES(rating),
           effortRating = VALUES(effortRating),
           liked = VALUES(liked),
           isEdited = 1`,
        [
          reviewId,
          postId,
          userId,
          comment,
          clampedRating,
          clampedEffortRating,
          liked === true ? 1 : liked === false ? 0 : null,
        ]
      );

      // Recalculate post average rating
      await pool.query(
        `UPDATE posts SET
          avgRating = (SELECT AVG(rating) FROM postReviews WHERE postId = ? AND isHidden = 0),
          reviewCount = (SELECT COUNT(*) FROM postReviews WHERE postId = ? AND isHidden = 0),
          likeCount = (SELECT COUNT(*) FROM postReviews WHERE postId = ? AND liked = 1 AND isHidden = 0),
          dislikeCount = (SELECT COUNT(*) FROM postReviews WHERE postId = ? AND liked = 0 AND isHidden = 0)
         WHERE id = ?`,
        [postId, postId, postId, postId, postId]
      );

      res.status(201).json({ id: reviewId, message: 'Review submitted' });
    } catch (err) {
      console.error('POST /api/posts/:id/reviews error:', err);
      res.status(500).json({ error: 'Failed to submit review' });
    }
  });

  /**
   * POST /api/posts/:id/tip
   * Body: { amount: number, message?: string }
   */
  server.post(PROXY + '/api/posts/:id/tip', authenticateToken, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const postId = String(req.params.id || '').trim();
      const senderUserId = String(req.user.id || '').trim();
      const amount = Number(req.body?.amount || 0);
      const message = String(req.body?.message || '').trim();

      if (!postId) return res.status(400).json({ error: 'Invalid post id' });
      if (!Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Tip amount must be a whole number greater than 0' });
      }
      if (amount > 1_000_000) {
        return res.status(400).json({ error: 'Tip amount is too large' });
      }
      if (message.length > 500) {
        return res.status(400).json({ error: 'Tip message cannot exceed 500 characters' });
      }

      await conn.beginTransaction();

      const [postRows] = await conn.query(
        'SELECT id, creatorId, title FROM posts WHERE id = ? LIMIT 1 FOR UPDATE',
        [postId]
      );
      const post = postRows?.[0];
      if (!post) {
        await conn.rollback();
        return res.status(404).json({ error: 'Post not found' });
      }

      const recipientUserId = String(post.creatorId || '').trim();
      if (!recipientUserId) {
        await conn.rollback();
        return res.status(400).json({ error: 'Post owner not found' });
      }
      if (recipientUserId === senderUserId) {
        await conn.rollback();
        return res.status(400).json({ error: 'You cannot tip your own post' });
      }

      const [senderRows] = await conn.query(
        'SELECT id, username, credits FROM userData WHERE id = ? LIMIT 1 FOR UPDATE',
        [senderUserId]
      );
      const sender = senderRows?.[0];
      if (!sender) {
        await conn.rollback();
        return res.status(404).json({ error: 'Sender account not found' });
      }

      const [recipientRows] = await conn.query(
        'SELECT id, username, credits FROM userData WHERE id = ? LIMIT 1 FOR UPDATE',
        [recipientUserId]
      );
      const recipient = recipientRows?.[0];
      if (!recipient) {
        await conn.rollback();
        return res.status(404).json({ error: 'Recipient account not found' });
      }

      const senderCredits = Number(sender.credits || 0);
      const recipientCredits = Number(recipient.credits || 0);
      if (senderCredits < amount) {
        await conn.rollback();
        return res.status(400).json({ error: 'Insufficient credits' });
      }

      const nextSenderCredits = senderCredits - amount;
      const nextRecipientCredits = recipientCredits + amount;

      await conn.query('UPDATE userData SET credits = ? WHERE id = ?', [nextSenderCredits, senderUserId]);
      await conn.query('UPDATE userData SET credits = ? WHERE id = ?', [nextRecipientCredits, recipientUserId]);

      const tipId = uuidv4();
      await conn.query(
        'INSERT INTO postTips (id, postId, senderUserId, recipientUserId, amount, message) VALUES (?, ?, ?, ?, ?, ?)',
        [tipId, postId, senderUserId, recipientUserId, amount, message || null]
      );

      await conn.commit();

      await insertWalletTransaction(pool, {
        userId: senderUserId,
        type: 'tip',
        amount: -amount,
        balanceAfter: nextSenderCredits,
        relatedPostId: postId,
        description: `Tip sent to ${recipient.username || recipientUserId} on post ${post.title || postId}`,
      });

      await insertWalletTransaction(pool, {
        userId: recipientUserId,
        type: 'tip',
        amount,
        balanceAfter: nextRecipientCredits,
        relatedPostId: postId,
        description: `Tip received from ${sender.username || senderUserId} on post ${post.title || postId}`,
      });

      await createNotif(pool, {
        userId: recipientUserId,
        type: 'tip_received',
        title: 'You received a tip',
        message: `${sender.username || 'A supporter'} tipped you ${amount} credits${message ? `: "${message}"` : ''}`,
        priority: 'success',
        category: 'earning',
        relatedPostId: postId,
      });

      await createNotif(pool, {
        userId: senderUserId,
        type: 'tip_sent',
        title: 'Tip sent',
        message: `You tipped ${recipient.username || 'the creator'} ${amount} credits${message ? `: "${message}"` : ''}`,
        priority: 'info',
        category: 'payment',
        relatedPostId: postId,
      });

      return res.json({
        success: true,
        tipId,
        senderBalance: nextSenderCredits,
      });
    } catch (err) {
      await conn.rollback();
      console.error('POST /api/posts/:id/tip error:', err);
      return res.status(500).json({ error: 'Failed to process tip' });
    } finally {
      conn.release();
    }
  });

  /**
   * GET /api/posts/:id/tips
   * Creator-only list of tips received for the post.
   */
  server.get(PROXY + '/api/posts/:id/tips', authenticateToken, async (req, res) => {
    try {
      const postId = String(req.params.id || '').trim();
      const userId = String(req.user?.id || '').trim();

      if (!postId) return res.status(400).json({ error: 'Invalid post id' });

      const [postRows] = await pool.query(
        'SELECT id, creatorId FROM posts WHERE id = ? LIMIT 1',
        [postId]
      );
      const post = postRows?.[0];
      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (String(post.creatorId || '') !== userId) {
        return res.status(403).json({ error: 'Only the post creator can view tips for this post' });
      }

      const [rows] = await pool.query(
        `SELECT
           t.id,
           t.senderUserId,
           COALESCE(u.username, t.senderUserId) AS senderUsername,
           t.amount,
           t.message,
           t.created_at
         FROM postTips t
         LEFT JOIN userData u ON u.id = t.senderUserId
         WHERE t.postId = ?
         ORDER BY t.created_at DESC
         LIMIT 200`,
        [postId]
      );

      const totalTips = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
      res.json({ tips: rows, totalTips, count: rows.length });
    } catch (err) {
      console.error('GET /api/posts/:id/tips error:', err);
      res.status(500).json({ error: 'Failed to load tips' });
    }
  });

  /**
   * POST /api/posts/:id/reaction
   * Body: { reaction: 'like' | 'dislike' }
   */
  server.post(PROXY + '/api/posts/:id/reaction', authenticateToken, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const userId = req.user.id;
      const postId = req.params.id;
      const reaction = String(req.body?.reaction || '').toLowerCase();

      if (!['like', 'dislike'].includes(reaction)) {
        return res.status(400).json({ error: 'reaction must be like or dislike' });
      }

      await conn.beginTransaction();

      const [[post]] = await conn.query(
        'SELECT id, likeCount, dislikeCount FROM posts WHERE id = ? FOR UPDATE',
        [postId]
      );
      if (!post) {
        await conn.rollback();
        return res.status(404).json({ error: 'Post not found' });
      }

      const [[existing]] = await conn.query(
        'SELECT id, reaction FROM postReactions WHERE postId = ? AND userId = ? FOR UPDATE',
        [postId, userId]
      );

      let nextReaction = reaction;
      let likeCount = Number(post.likeCount) || 0;
      let dislikeCount = Number(post.dislikeCount) || 0;

      if (existing && existing.reaction === reaction) {
        await conn.query('DELETE FROM postReactions WHERE id = ?', [existing.id]);
        nextReaction = null;
        if (reaction === 'like') likeCount = Math.max(0, likeCount - 1);
        if (reaction === 'dislike') dislikeCount = Math.max(0, dislikeCount - 1);
      } else if (existing) {
        await conn.query('UPDATE postReactions SET reaction = ? WHERE id = ?', [reaction, existing.id]);
        if (existing.reaction === 'like') likeCount = Math.max(0, likeCount - 1);
        if (existing.reaction === 'dislike') dislikeCount = Math.max(0, dislikeCount - 1);
        if (reaction === 'like') likeCount += 1;
        if (reaction === 'dislike') dislikeCount += 1;
      } else {
        await conn.query(
          'INSERT INTO postReactions (id, postId, userId, reaction) VALUES (?, ?, ?, ?)',
          [uuidv4(), postId, userId, reaction]
        );
        if (reaction === 'like') likeCount += 1;
        if (reaction === 'dislike') dislikeCount += 1;
      }

      await conn.query(
        'UPDATE posts SET likeCount = ?, dislikeCount = ? WHERE id = ?',
        [likeCount, dislikeCount, postId]
      );

      await conn.commit();
      res.json({ reaction: nextReaction, likeCount, dislikeCount });
    } catch (err) {
      await conn.rollback();
      console.error('POST /api/posts/:id/reaction error:', err);
      res.status(500).json({ error: 'Failed to record reaction' });
    } finally {
      conn.release();
    }
  });

  /**
   * POST /api/posts/:id/flag
   * Body: { reason: 'spam'|'scam'|'explicit'|'abuse'|'plagiarism'|'impersonation' }
   */
  server.post(PROXY + '/api/posts/:id/flag', authenticateToken, async (req, res) => {
    try {
      const postId = String(req.params.id || '').trim();
      const userId = String(req.user.id || '').trim();
      const reason = String(req.body?.reason || '').trim().toLowerCase();
      const description = String(req.body?.description || '').trim();
      const evidenceUrlRaw = String(req.body?.evidenceUrl || '').trim();
      const allowedReasons = new Set(['spam', 'scam', 'explicit', 'abuse', 'plagiarism', 'impersonation']);

      if (!postId) return res.status(400).json({ error: 'Invalid post id' });
      if (!allowedReasons.has(reason)) return res.status(400).json({ error: 'Invalid reason' });
      if (description.length < 60 || description.length > 900) {
        return res.status(400).json({ error: 'Explanation must be between 60 and 900 characters' });
      }
      if (evidenceUrlRaw && !/^https?:\/\//i.test(evidenceUrlRaw)) {
        return res.status(400).json({ error: 'Evidence URL must start with http:// or https://' });
      }

      const evidenceUrl = evidenceUrlRaw.slice(0, 400);
      const descriptionStored = evidenceUrl
        ? `${description}\n\nEvidence URL: ${evidenceUrl}`
        : description;

      const [postRows] = await pool.query('SELECT id FROM posts WHERE id = ? LIMIT 1', [postId]);
      if (!postRows.length) return res.status(404).json({ error: 'Post not found' });

      const [existingRows] = await pool.query(
        'SELECT id FROM postFlags WHERE postId = ? AND userId = ? LIMIT 1',
        [postId, userId]
      );

      if (existingRows.length) {
        await pool.query(
          'UPDATE postFlags SET reason = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE postId = ? AND userId = ?',
          [reason, descriptionStored, postId, userId]
        );
      } else {
        await pool.query(
          'INSERT INTO postFlags (id, postId, userId, reason, description) VALUES (?, ?, ?, ?, ?)',
          [uuidv4(), postId, userId, reason, descriptionStored]
        );
      }

      const [[counts]] = await pool.query(
        'SELECT COUNT(*) AS flagCount FROM postFlags WHERE postId = ?',
        [postId]
      );

      const flagCount = Number(counts?.flagCount || 0);
      res.json({
        success: true,
        flagCount,
        hiddenFromExplore: flagCount >= 3,
        hiddenFromRecommendations: flagCount >= 5,
      });
    } catch (err) {
      console.error('POST /api/posts/:id/flag error:', err);
      res.status(500).json({ error: 'Failed to flag post' });
    }
  });

  // ============================================================
  //  COMMENTS / REPLIES / REACTIONS
  // ============================================================

  /**
   * GET /api/posts/:id/comments
   */
  server.get(PROXY + '/api/posts/:id/comments', async (req, res) => {
    try {
      const postId = req.params.id;

      const [rows] = await pool.query(
        `SELECT
           c.id,
           c.postId,
           c.userId,
           c.parentCommentId,
           c.comment,
           c.created_at AS createdAt,
           u.username,
           u.profilePicture AS avatar,
           COALESCE(SUM(CASE WHEN r.reaction = 'like' THEN 1 ELSE 0 END), 0) AS likeCount,
           COALESCE(SUM(CASE WHEN r.reaction = 'dislike' THEN 1 ELSE 0 END), 0) AS dislikeCount
         FROM postComments c
         JOIN userData u ON u.id = c.userId
         LEFT JOIN postCommentReactions r ON r.commentId = c.id
         WHERE c.postId = ? AND c.isDeleted = 0
         GROUP BY c.id, c.postId, c.userId, c.parentCommentId, c.comment, c.created_at, u.username, u.profilePicture
         ORDER BY c.created_at ASC`,
        [postId]
      );

      const byId = new Map();
      const roots = [];

      for (const row of rows) {
        byId.set(row.id, {
          id: row.id,
          userId: row.userId,
          username: row.username,
          avatar: row.avatar || null,
          comment: row.comment,
          parentCommentId: row.parentCommentId,
          createdAt: row.createdAt,
          likeCount: Number(row.likeCount) || 0,
          dislikeCount: Number(row.dislikeCount) || 0,
          myReaction: null,
          replies: [],
        });
      }

      for (const row of rows) {
        const node = byId.get(row.id);
        if (!node) continue;
        if (row.parentCommentId && byId.has(row.parentCommentId)) {
          byId.get(row.parentCommentId).replies.push(node);
        } else {
          roots.push(node);
        }
      }

      res.json({ comments: roots });
    } catch (err) {
      console.error('GET /api/posts/:id/comments error:', err);
      res.status(500).json({ error: 'Failed to fetch comments' });
    }
  });

  /**
   * POST /api/posts/:id/comments
   * Body: { comment, parentCommentId? }
   */
  server.post(PROXY + '/api/posts/:id/comments', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const postId = req.params.id;
      const { comment, parentCommentId } = req.body;

      if (!comment || !String(comment).trim()) {
        return res.status(400).json({ error: 'Comment is required' });
      }

      if (parentCommentId) {
        const [[parent]] = await pool.query(
          'SELECT id, postId FROM postComments WHERE id = ? AND isDeleted = 0',
          [parentCommentId]
        );
        if (!parent) return res.status(404).json({ error: 'Parent comment not found' });
        if (parent.postId !== postId) return res.status(400).json({ error: 'Invalid parent comment target' });
      }

      const commentId = uuidv4();
      await pool.query(
        `INSERT INTO postComments (id, postId, userId, parentCommentId, comment)
         VALUES (?, ?, ?, ?, ?)`,
        [commentId, postId, userId, parentCommentId || null, String(comment).trim()]
      );

      res.status(201).json({ id: commentId, message: 'Comment posted' });
    } catch (err) {
      console.error('POST /api/posts/:id/comments error:', err);
      res.status(500).json({ error: 'Failed to post comment' });
    }
  });

  /**
   * POST /api/comments/:id/reply
   * Body: { comment }
   */
  server.post(PROXY + '/api/comments/:id/reply', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const parentId = req.params.id;
      const { comment } = req.body;

      if (!comment || !String(comment).trim()) {
        return res.status(400).json({ error: 'Comment is required' });
      }

      const [[parent]] = await pool.query(
        'SELECT id, postId FROM postComments WHERE id = ? AND isDeleted = 0',
        [parentId]
      );
      if (!parent) return res.status(404).json({ error: 'Parent comment not found' });

      const commentId = uuidv4();
      await pool.query(
        `INSERT INTO postComments (id, postId, userId, parentCommentId, comment)
         VALUES (?, ?, ?, ?, ?)`,
        [commentId, parent.postId, userId, parentId, String(comment).trim()]
      );

      res.status(201).json({ id: commentId, message: 'Reply posted' });
    } catch (err) {
      console.error('POST /api/comments/:id/reply error:', err);
      res.status(500).json({ error: 'Failed to post reply' });
    }
  });

  /**
   * POST /api/comments/:id/reaction
   * Body: { reaction: 'like' | 'dislike' }
   */
  server.post(PROXY + '/api/comments/:id/reaction', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const commentId = req.params.id;
      const { reaction } = req.body;

      if (!['like', 'dislike'].includes(reaction)) {
        return res.status(400).json({ error: 'reaction must be like or dislike' });
      }

      const [[comment]] = await pool.query('SELECT id FROM postComments WHERE id = ? AND isDeleted = 0', [commentId]);
      if (!comment) return res.status(404).json({ error: 'Comment not found' });

      const [[existing]] = await pool.query(
        'SELECT id, reaction FROM postCommentReactions WHERE commentId = ? AND userId = ?',
        [commentId, userId]
      );

      if (existing && existing.reaction === reaction) {
        await pool.query('DELETE FROM postCommentReactions WHERE id = ?', [existing.id]);
        return res.json({ reaction: null, message: 'Reaction removed' });
      }

      if (existing) {
        await pool.query(
          'UPDATE postCommentReactions SET reaction = ? WHERE id = ?',
          [reaction, existing.id]
        );
      } else {
        await pool.query(
          'INSERT INTO postCommentReactions (id, commentId, userId, reaction) VALUES (?, ?, ?, ?)',
          [uuidv4(), commentId, userId, reaction]
        );
      }

      res.json({ reaction, message: 'Reaction updated' });
    } catch (err) {
      console.error('POST /api/comments/:id/reaction error:', err);
      res.status(500).json({ error: 'Failed to react to comment' });
    }
  });

  // Alias route for clients using /react.
  server.post(PROXY + '/api/comments/:id/react', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const commentId = req.params.id;
      const { reaction } = req.body;

      if (!['like', 'dislike'].includes(reaction)) {
        return res.status(400).json({ error: 'reaction must be like or dislike' });
      }

      const [[comment]] = await pool.query('SELECT id FROM postComments WHERE id = ? AND isDeleted = 0', [commentId]);
      if (!comment) return res.status(404).json({ error: 'Comment not found' });

      const [[existing]] = await pool.query(
        'SELECT id, reaction FROM postCommentReactions WHERE commentId = ? AND userId = ?',
        [commentId, userId]
      );

      if (existing && existing.reaction === reaction) {
        await pool.query('DELETE FROM postCommentReactions WHERE id = ?', [existing.id]);
        return res.json({ reaction: null, message: 'Reaction removed' });
      }

      if (existing) {
        await pool.query(
          'UPDATE postCommentReactions SET reaction = ? WHERE id = ?',
          [reaction, existing.id]
        );
      } else {
        await pool.query(
          'INSERT INTO postCommentReactions (id, commentId, userId, reaction) VALUES (?, ?, ?, ?)',
          [uuidv4(), commentId, userId, reaction]
        );
      }

      res.json({ reaction, message: 'Reaction updated' });
    } catch (err) {
      console.error('POST /api/comments/:id/react error:', err);
      res.status(500).json({ error: 'Failed to react to comment' });
    }
  });


  // ============================================================
  //  FAVORITES / WAITLIST
  // ============================================================

  /**
   * POST /api/posts/:id/favorite
   * Toggle favorite. Returns { favorited: true/false }.
   */
  server.post(PROXY + '/api/posts/:id/favorite', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const postId = req.params.id;

      const [[existing]] = await pool.query(
        'SELECT id FROM postFavorites WHERE postId = ? AND userId = ?', [postId, userId]
      );

      if (existing) {
        await pool.query('DELETE FROM postFavorites WHERE id = ?', [existing.id]);
        res.json({ favorited: false });
      } else {
        await pool.query(
          'INSERT INTO postFavorites (postId, userId) VALUES (?, ?)', [postId, userId]
        );
        res.json({ favorited: true });
      }
    } catch (err) {
      console.error('POST /api/posts/:id/favorite error:', err);
      res.status(500).json({ error: 'Failed to toggle favorite' });
    }
  });

  /**
   * GET /api/user/favorites
   * Get current user's favorited posts.
   */
  server.get(PROXY + '/api/user/favorites', authenticateToken, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT d.*, u.username AS creatorName, u.profilePicture AS creatorAvatar,
                f.created_at AS favoritedAt
         FROM postFavorites f
         JOIN posts d ON d.id = f.postId
         JOIN userData u ON u.id = d.creatorId
         WHERE f.userId = ?
         ORDER BY f.created_at DESC`,
        [req.user.id]
      );
      res.json(serializePosts(req, rows));
    } catch (err) {
      console.error('GET /api/user/favorites error:', err);
      res.status(500).json({ error: 'Failed to fetch favorites' });
    }
  });


  // ============================================================
  //  USER PROFILES
  // ============================================================

  /**
   * GET /api/users/search?q=
   * Search users by username (partial match). Must be defined BEFORE /api/users/:id.
   */
  server.get(PROXY + '/api/users/search', async (req, res) => {
    try {
      const q = (req.query.q || '').toString().trim();
      if (!q || q.length < 2) return res.json([]);
      const [rows] = await pool.query(
        `SELECT id, username, profilePicture, bio, accountPlan,
                totalPostsCreated, totalCreditsEarned
         FROM userData
         WHERE username LIKE ? AND isBanned = 0
         ORDER BY totalPostsCreated DESC
         LIMIT 15`,
        [`%${q}%`]
      );
      res.json(rows);
    } catch (err) {
      console.error('GET /api/users/search error:', err);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  /**
   * GET /api/users/:id
   * Public profile data.
   */
  server.get(PROXY + '/api/users/:id', async (req, res) => {
    try {
      const identifier = String(req.params.id || '').trim();
      const [rows] = await pool.query(
        `SELECT id, username, profilePicture, bio, accountPlan, accountType,
                totalPostsCreated, totalCreditsEarned, creatorRating, createdAt,
                bannerUrl, bioVideoUrl, socialLinks,
                (SELECT COUNT(*) FROM followers WHERE followeeId = userData.id) AS followerCount,
                (SELECT COUNT(*) FROM followers WHERE followerId = userData.id) AS followingCount
         FROM userData WHERE id = ? OR username = ? LIMIT 1`,
        [identifier, identifier]
      );
      if (!rows.length) return res.status(404).json({ error: 'User not found' });
      const profile = rows[0];
      profile.profilePicture = resolveProfileAssetUrl(req, profile.profilePicture);
      profile.bannerUrl = resolveProfileAssetUrl(req, profile.bannerUrl);
      res.json(profile);
    } catch (err) {
      console.error('GET /api/users/:id error:', err);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });

  /**
   * GET /api/users/:id/posts
   * Public posts for a user profile.
   */
  server.get(PROXY + '/api/users/:id/posts', async (req, res) => {
    try {
      const { status } = req.query;
      const identifier = String(req.params.id || '').trim();
      const [[userRow]] = await pool.query(
        'SELECT id FROM userData WHERE id = ? OR username = ? LIMIT 1',
        [identifier, identifier]
      );
      if (!userRow) return res.status(404).json({ error: 'User not found' });

      let where = 'd.creatorId = ? AND d.isPublic = 1';
      const params = [userRow.id];
      if (status) {
        where += ' AND d.status = ?';
        params.push(status);
      }
      const [rows] = await pool.query(
        `SELECT d.*, (SELECT COUNT(*) FROM postFlags pf WHERE pf.postId = d.id) AS flagCount
         FROM posts d WHERE ${where} ORDER BY d.created_at DESC LIMIT 50`,
        params
      );
      res.json(rows);
    } catch (err) {
      console.error('GET /api/users/:id/posts error:', err);
      res.status(500).json({ error: 'Failed to fetch user posts' });
    }
  });


  // ============================================================
  //  FOLLOWERS
  // ============================================================

  /**
   * GET /api/users/:id/am-i-following
   * Returns { following: true/false } for the authenticated user.
   */
  server.get(PROXY + '/api/users/:id/am-i-following', authenticateToken, async (req, res) => {
    try {
      const followerId = req.user.id;
      const followeeId = req.params.id;
      if (followerId === followeeId) return res.json({ following: false });

      const [[existing]] = await pool.query(
        'SELECT id FROM followers WHERE followerId = ? AND followeeId = ?',
        [followerId, followeeId]
      );
      res.json({ following: !!existing });
    } catch (err) {
      console.error('GET /api/users/:id/am-i-following error:', err);
      res.status(500).json({ error: 'Failed to check follow status' });
    }
  });

  /**
   * POST /api/users/:id/follow
   * Toggle follow. Returns { following: true/false, followerCount: number }.
   */
  server.post(PROXY + '/api/users/:id/follow', authenticateToken, async (req, res) => {
    try {
      const followerId = req.user.id;
      const followeeId = req.params.id;
      if (followerId === followeeId) return res.status(400).json({ error: 'Cannot follow yourself' });

      const [[existing]] = await pool.query(
        'SELECT id FROM followers WHERE followerId = ? AND followeeId = ?',
        [followerId, followeeId]
      );

      if (existing) {
        await pool.query('DELETE FROM followers WHERE id = ?', [existing.id]);
      } else {
        await pool.query(
          'INSERT INTO followers (followerId, followeeId) VALUES (?, ?)',
          [followerId, followeeId]
        );
      }

      const [[countRow]] = await pool.query(
        'SELECT COUNT(*) AS followerCount FROM followers WHERE followeeId = ?',
        [followeeId]
      );
      res.json({ following: !existing, followerCount: Number(countRow?.followerCount ?? 0) });
    } catch (err) {
      console.error('POST /api/users/:id/follow error:', err);
      res.status(500).json({ error: 'Failed to toggle follow' });
    }
  });

  /**
   * GET /api/users/:id/followers
   */
  server.get(PROXY + '/api/users/:id/followers', async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT u.id, u.username, u.profilePicture, u.bio
         FROM followers f
         JOIN userData u ON u.id = f.followerId
         WHERE f.followeeId = ?
         ORDER BY f.createdAt DESC LIMIT 100`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err) {
      console.error('GET /api/users/:id/followers error:', err);
      res.status(500).json({ error: 'Failed to fetch followers' });
    }
  });

  /**
   * GET /api/users/:id/following
   */
  server.get(PROXY + '/api/users/:id/following', async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT u.id, u.username, u.profilePicture, u.bio
         FROM followers f
         JOIN userData u ON u.id = f.followeeId
         WHERE f.followerId = ?
         ORDER BY f.createdAt DESC LIMIT 100`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err) {
      console.error('GET /api/users/:id/following error:', err);
      res.status(500).json({ error: 'Failed to fetch following' });
    }
  });


  // ============================================================
  //  DASHBOARD — Authenticated user's overview
  // ============================================================

  /**
   * POST /api/tags/interaction
   * Stores tag interaction events from client-side Explore/feed behavior.
   */
  server.post(PROXY + '/api/tags/interaction', async (req, res) => {
    try {
      const {
        userId = null,
        postId = null,
        tags = [],
        eventType = 'open',
        source = 'explore',
      } = req.body || {};

      const safeTags = Array.isArray(tags)
        ? tags
          .map((tag) => String(tag || '').replace(/^#/, '').trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 20)
        : [];

      await pool.query(
        `INSERT INTO tagInteractions (userId, postId, tags, eventType, source)
         VALUES (?, ?, ?, ?, ?)`,
        [
          userId ? String(userId) : null,
          postId ? String(postId) : null,
          JSON.stringify(safeTags),
          String(eventType || 'open').slice(0, 32),
          String(source || 'explore').slice(0, 32),
        ]
      );

      res.json({ success: true });
    } catch (err) {
      console.error('POST /api/tags/interaction error:', err);
      res.status(500).json({ success: false, error: 'Failed to record tag interaction' });
    }
  });

  /**
   * GET /api/dashboard
   * Returns my posts, my contributions, stats.
   */
  server.get(PROXY + '/api/dashboard', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;

      // My posts
      const [myPosts] = await pool.query(
        `SELECT * FROM posts WHERE creatorId = ? ORDER BY created_at DESC`, [userId]
      );

      // // posts I contributed to (aggregated)
      // const [contributed] = await pool.query(
      //   `SELECT d.*, SUM(c.amount) AS myContribution
      //    FROM contributions c
      //    JOIN posts d ON d.id = c.postId
      //    WHERE c.userId = ? AND c.isRefunded = 0
      //    GROUP BY c.postId
      //    ORDER BY MAX(c.created_at) DESC`,
      //   [userId]
      // );

      // // Quick stats
      // const [[stats]] = await pool.query(
      //   `SELECT
      //      (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE userId = ? AND isRefunded = 0) AS totalContributed,
      //      (SELECT COUNT(DISTINCT postId) FROM contributions WHERE userId = ? AND isRefunded = 0) AS postsContributedTo,
      //      (SELECT COALESCE(SUM(totalRevenue),0) FROM posts WHERE creatorId = ?) AS totalEarned,
      //      (SELECT COUNT(*) FROM posts WHERE creatorId = ? AND status != 'removed') AS totalMyPosts,
      //      (SELECT COUNT(*) FROM postFavorites WHERE userId = ?) AS totalFavorites`,
      //   [userId, userId, userId, userId, userId]
      // );

      // User info
      const [[user]] = await pool.query(
        'SELECT id, username, email, credits, profilePicture, accountPlan FROM userData WHERE id = ?',
        [userId]
      );

      // res.json({ user, myPosts, contributed, stats });
      res.json({ user, myPosts: serializePosts(req, myPosts) });
    } catch (err) {
      console.error('GET /api/dashboard error:', err);
      res.status(500).json({ error: 'Failed to fetch dashboard' });
    }
  });


  // ============================================================
  //  CONTRIBUTION HISTORY — user's past contributions
  // ============================================================







  // ============================================================
  //  POST FILE UPLOAD — GCS Signed URL (resumable)
  //
  //  Flow:
  //  1. Client calls POST /api/posts/:id/upload-url with file metadata
  //  2. Server returns a short-lived GCS signed URL
  //  3. Client uploads directly to GCS (file never touches this server)
  //  4. Client calls POST /api/posts/:id/confirm-upload
  //  5. Server verifies the file exists in GCS and updates the DB
  // ============================================================

  // Allowed post file MIME types
  const POST_MIME_TYPES = new Set([
    
    // Video
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
    // Audio
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac',
    'audio/vnd.wave', 'audio/wave', 'audio/x-wav', 'audio/x-pn-wav',  // .wav variants
    'audio/x-mpeg', 'audio/x-mp3',                                     // .mp3 variants
    'audio/x-flac',                                                     // .flac variant
    'audio/x-aac', 'audio/x-m4a', 'audio/m4a', 'audio/mp4',           // .m4a / .mp4 audio
    'audio/x-ogg', 'application/ogg', 'video/ogg',                     // .ogg variants
    'audio/webm',                                                       // .webm audio
    // Images
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    // Documents
    'application/pdf',
    'application/zip', 'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    "text/plain",
    'text/html',
    'application/json',
    // Apps / Games
    'application/octet-stream',
    'application/x-msdownload',
    'application/vnd.android.package-archive',
    'application/x-apple-diskimage',
  ]);

  /**
   * POST /api/posts/:id/upload-url
   * Returns a GCS signed resumable-upload URL.
   * Body: { fileName, fileType (MIME), fileSize (bytes) }
   */
  server.post(PROXY + '/api/posts/:id/upload-url', authenticateToken, async (req, res) => {
    try {
      if (!storage) return res.status(503).json({ error: 'Cloud storage not configured' });

      const userId = req.user.id;
      const postId = req.params.id;
      const { fileName, fileType, fileSize } = req.body;

      if (!fileName || !fileType) {
        return res.status(400).json({ error: 'fileName and fileType are required' });
      }
      if (!POST_MIME_TYPES.has(fileType)) {
        return res.status(400).json({ error: `Unsupported file type: ${fileType}` });
      }
      const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB
      if (fileSize && +fileSize > MAX_FILE_SIZE) {
        return res.status(400).json({ error: 'File exceeds 5 GB limit' });
      }

      // Verify ownership
      const [[post]] = await pool.query('SELECT creatorId, status FROM posts WHERE id = ?', [postId]);
      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.creatorId !== userId) return res.status(403).json({ error: 'Not the creator' });
      if (!['draft', 'pending'].includes(post.status)) {
        return res.status(400).json({ error: 'Can only upload files for draft or pending posts' });
      }

      // Build GCS destination path
      const ext = path.extname(fileName) || '';
      const safeBase = path.basename(fileName, ext)
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9._-]/g, '')
        .slice(0, 100);
      const gcsFileName = `${uuidv4()}_${safeBase}${ext}`;
      const gcsPath = `${DEST_PREFIX}/posts/${userId}/${postId}/${gcsFileName}`;

      const signedUrl = await signUrl(
        storage,
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: gcsPath,
          ContentType: fileType,
        }),
        { expiresIn: 15 * 60 }
      );

      // Store the pending path so confirm-upload can verify it
      await pool.query(
        `UPDATE posts SET filePath = ?, mimeType = ?, fileSize = ? WHERE id = ?`,
        [gcsPath, fileType, fileSize ? +fileSize : null, postId]
      );

      res.json({
        uploadUrl: signedUrl,
        gcsPath,
        expiresIn: '15 minutes',
        instructions: {
          method: 'PUT',
          headers: { 'Content-Type': fileType },
          body: '(raw file bytes)',
        },
      });
    } catch (err) {
      console.error('POST /api/posts/:id/upload-url error:', err);
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  });

  /**
   * POST /api/posts/:id/confirm-upload
   * Client calls this after the direct-to-GCS upload finishes.
   * Server verifies the file exists and finalises the DB record.
   * Body: { originalFileName? }
   */
  server.post(PROXY + '/api/posts/:id/confirm-upload', authenticateToken, async (req, res) => {
    try {
      if (!storage) return res.status(503).json({ error: 'Cloud storage not configured' });

      const userId = req.user.id;
      const postId = req.params.id;

      const [[post]] = await pool.query(
        'SELECT creatorId, filePath, status FROM posts WHERE id = ?', [postId]
      );
      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.creatorId !== userId) return res.status(403).json({ error: 'Not the creator' });
      if (!post.filePath) return res.status(400).json({ error: 'No upload in progress for this post' });

      let metadata;
      try {
        const head = await storage.send(new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: normalizeObjectKey(post.filePath),
        }));
        metadata = {
          size: head.ContentLength,
          contentType: head.ContentType,
        };
      } catch (headErr) {
        return res.status(400).json({ error: 'File not found in storage — upload may have failed' });
      }

      const updates = {
        fileSize: metadata.size ? +metadata.size : null,
        mimeType: metadata.contentType || null,
      };
      if (req.body.originalFileName) {
        updates.originalFileName = req.body.originalFileName;
      }

      const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await pool.query(`UPDATE posts SET ${sets} WHERE id = ?`, [...Object.values(updates), postId]);

      res.json({
        message: 'Upload confirmed',
        fileSize: updates.fileSize,
        mimeType: updates.mimeType,
        gcsPath: post.filePath,
      });
    } catch (err) {
      console.error('POST /api/posts/:id/confirm-upload error:', err);
      res.status(500).json({ error: 'Failed to confirm upload' });
    }
  });


  // ============================================================
  //  POST FILE DOWNLOAD — Signed download URL
  //
  //  After a user purchases a download (POST /api/posts/:id/download),
  //  this endpoint returns a short-lived signed URL so the client
  //  can stream the file directly from GCS.
  // ============================================================

  /**
   * GET /api/posts/:id/download-url
   * Returns a 1-hour signed download URL. Must have a download record.
   */
  server.get(PROXY + '/api/posts/:id/download-url', authenticateToken, async (req, res) => {
    try {
      if (!storage) return res.status(503).json({ error: 'Cloud storage not configured' });

      const postId = req.params.id;

      const [[post]] = await pool.query('SELECT filePath, title FROM posts WHERE id = ?', [postId]);
      if (!post || !post.filePath) return res.status(404).json({ error: 'Post file not found' });

      const signedUrl = await signUrl(
        storage,
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: normalizeObjectKey(post.filePath),
          ResponseContentDisposition: `attachment; filename="${(post.title || 'download').replace(/"/g, '_')}"`,
        }),
        { expiresIn: 60 * 60 }
      );

      res.json({ downloadUrl: signedUrl, expiresIn: '1 hour' });
    } catch (err) {
      console.error('GET /api/posts/:id/download-url error:', err);
      res.status(500).json({ error: 'Failed to generate download URL' });
    }
  });

  /**
   * GET /api/posts/:id/thumbnail
   * Resolves a stored thumbnail key to a short-lived signed URL and redirects to it.
   */
  server.get(PROXY + '/api/posts/:id/thumbnail', async (req, res) => {
    try {
      const postId = req.params.id;
      const [[post]] = await pool.query('SELECT thumbnailUrl FROM posts WHERE id = ?', [postId]);
      if (!post || !post.thumbnailUrl) return res.status(404).json({ error: 'Thumbnail not found' });

      const storedValue = String(post.thumbnailUrl).trim();
      if (/^https?:\/\//i.test(storedValue)) {
        return res.redirect(storedValue);
      }

      if (storedValue.startsWith('/uploads/')) {
        return res.redirect(buildAbsoluteUrl(req, storedValue));
      }

      if (!storage) return res.status(503).json({ error: 'Cloud storage not configured' });

      const signedUrl = await signUrl(
        storage,
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: normalizeObjectKey(storedValue),
        }),
        { expiresIn: 5 * 60 }
      );

      res.set('Cache-Control', 'private, max-age=240');
      return res.redirect(signedUrl);
    } catch (err) {
      console.error('GET /api/posts/:id/thumbnail error:', err);
      return res.status(500).json({ error: 'Failed to resolve thumbnail' });
    }
  });

  /**
   * POST /api/posts/:id/thumbnail-upload-url
   * Returns a short-lived signed upload URL for editing a post thumbnail.
   */
  server.post(PROXY + '/api/posts/:id/thumbnail-upload-url', authenticateToken, async (req, res) => {
    try {
      if (!storage) return res.status(503).json({ error: 'Cloud storage not configured' });

      const postId = req.params.id;
      const userId = req.user.id;
      const { fileName, mimeType } = req.body || {};

      if (!mimeType || !String(mimeType).startsWith('image/')) {
        return res.status(400).json({ error: 'Thumbnail must be an image' });
      }

      const post = await knex('posts')
        .select('creatorId', 'status')
        .where('id', postId)
        .first();

      if (!post) return res.status(404).json({ error: 'Post not found' });
      if (post.creatorId !== userId) return res.status(403).json({ error: 'Not the creator' });
      if (!['draft', 'pending'].includes(post.status)) {
        return res.status(400).json({ error: 'Can only edit draft or pending posts' });
      }

      const ext = (String(fileName || '').split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const key = `${DEST_PREFIX}/posts/${post.creatorId}/${postId}/thumbnails/${uuidv4()}.${ext}`;

      const signedUrl = await signUrl(
        storage,
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          ContentType: mimeType,
        }),
        { expiresIn: 15 * 60 }
      );

      res.json({ signedUrl, key });
    } catch (err) {
      console.error('POST /api/posts/:id/thumbnail-upload-url error:', err);
      res.status(500).json({ error: 'Failed to create upload URL' });
    }
  });


  // ============================================================
  //  BANNER / THUMBNAIL UPLOAD (multer — small images only)
  // ============================================================

  const bannerStorage = multer.diskStorage({
    destination(req, _file, cb) {
      const dir = path.join(__dirname, 'uploads', 'banners', req.user.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  });

  const bannerUpload = multer({
    storage: bannerStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter(_req, file, cb) {
      if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Only image files are allowed for banners'), false);
      }
      cb(null, true);
    },
  });

  /**
   * POST /api/posts/:id/banner
   * Upload a banner/thumbnail image for a post.
   */
  server.post(
    PROXY + '/api/posts/:id/banner',
    authenticateToken,
    bannerUpload.single('banner'),
    async (req, res) => {
      try {
        const userId = req.user.id;
        const postId = req.params.id;

        const [[post]] = await pool.query('SELECT creatorId, status FROM posts WHERE id = ?', [postId]);
        if (!post) return res.status(404).json({ error: 'Post not found' });
        if (post.creatorId !== userId) return res.status(403).json({ error: 'Not the creator' });

        if (!req.file) return res.status(400).json({ error: 'No banner file provided' });

        // If cloud storage is available, upload to R2; otherwise serve locally
        let thumbnailUrl;
        if (storage) {
          const ext = path.extname(req.file.originalname) || '.jpg';
          const gcsPath = `${DEST_PREFIX}/banners/${userId}/${uuidv4()}${ext}`;
          await storage.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: gcsPath,
            Body: fs.readFileSync(req.file.path),
            ContentType: req.file.mimetype,
          }));
          thumbnailUrl = gcsPath;
          // Clean up local temp file
          fs.unlink(req.file.path, () => { });
        } else {
          thumbnailUrl = `/uploads/banners/${userId}/${req.file.filename}`;
        }

        await pool.query('UPDATE posts SET thumbnailUrl = ? WHERE id = ?', [thumbnailUrl, postId]);

        res.json({
          message: 'Banner uploaded',
          thumbnailKey: thumbnailUrl,
          thumbnailUrl: resolveThumbnailUrl(req, postId, thumbnailUrl),
        });
      } catch (err) {
        console.error('POST /api/posts/:id/banner error:', err);
        res.status(500).json({ error: 'Banner upload failed' });
      }
    }
  );

  // ============================================================
  //  NOTIFICATIONS
  // ============================================================

  /** GET /api/notifications/me — paginated, newest first */
  server.get(PROXY + '/api/notifications/me', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const limit = Math.min(50, +(req.query.limit || 20));
      const [rows] = await pool.query(
        `SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT ?`,
        [userId, limit]
      );
      const unreadCount = rows.filter((r) => !r.isRead).length;
      res.json({ notifications: rows, unreadCount });
    } catch (err) {
      console.error('GET /api/notifications/me error:', err);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  /** PATCH /api/notifications/read-all — mark all as read */
  server.patch(PROXY + '/api/notifications/read-all', authenticateToken, async (req, res) => {
    try {
      await pool.query('UPDATE notifications SET isRead = 1 WHERE userId = ?', [req.user.id]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to mark all read' });
    }
  });

  /** PATCH /api/notifications/:id/read — mark one as read */
  server.patch(PROXY + '/api/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
      await pool.query(
        'UPDATE notifications SET isRead = 1 WHERE id = ? AND userId = ?',
        [req.params.id, req.user.id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to mark read' });
    }
  });

  /** DELETE /api/notifications/:id — delete a single notification */
  server.delete(PROXY + '/api/notifications/:id', authenticateToken, async (req, res) => {
    try {
      await pool.query(
        'DELETE FROM notifications WHERE id = ? AND userId = ?',
        [req.params.id, req.user.id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete notification' });
    }
  });


  // ============================================================
  //  HISTORY — Unified payment/activity history endpoints
  // ============================================================

  /**
   * GET /api/history/purchases
   * Returns the authenticated user's credit purchase history.
   */
  server.get(PROXY + '/api/history/purchases', authenticateToken, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, credits, amountPaid, currency, paymentMethod, status, txHash, created_at
         FROM CreditPurchases
         WHERE userId = ?
         ORDER BY created_at DESC
         LIMIT 200`,
        [req.user.id]
      );
      res.json({ purchases: rows });
    } catch (err) {
      console.error('GET /api/history/purchases error:', err);
      res.status(500).json({ error: 'Failed to fetch purchase history' });
    }
  });

  /**
   * GET /api/history/downloads
   * Returns the authenticated user's paid download history.
   */
  server.get(PROXY + '/api/history/downloads', authenticateToken, async (req, res) => {
    try {
      res.json({ downloads: [] });
    } catch (err) {
      console.error('GET /api/history/downloads error:', err);
      res.status(500).json({ error: 'Failed to fetch download history' });
    }
  });

  /**
   * GET /api/history/memberships
   * Returns membership charge history. Placeholder until the memberships table exists.
   */
  server.get(PROXY + '/api/history/memberships', authenticateToken, async (req, res) => {
    try {
      // Check if memberships table exists
      const [[tableCheck]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = 'memberships'`
      );
      if (!tableCheck || tableCheck.cnt === 0) {
        return res.json({ memberships: [], activePlan: null });
      }
      const [rows] = await pool.query(
        `SELECT id, plan, amount, billingPeriod, status, created_at
         FROM memberships
         WHERE userId = ?
         ORDER BY created_at DESC
         LIMIT 200`,
        [req.user.id]
      );
      const [[active]] = await pool.query(
        `SELECT plan FROM memberships WHERE userId = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
        [req.user.id]
      );
      res.json({ memberships: rows, activePlan: active?.plan || null });
    } catch (err) {
      console.error('GET /api/history/memberships error:', err);
      res.status(500).json({ error: 'Failed to fetch membership history' });
    }
  });

  /**
   * GET /api/history/earnings
   * Returns the authenticated user's creator earnings from downloads.
   */
  server.get(PROXY + '/api/history/earnings', authenticateToken, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT wt.id, wt.amount, wt.balanceAfter, wt.relatedPostId AS relatedpostId, wt.description, wt.created_at,
                d.title AS postTitle
         FROM walletTransactions wt
         LEFT JOIN posts d ON d.id = wt.relatedPostId
         WHERE wt.userId = ? AND (wt.type = 'creator_earning' OR wt.type = 'tip') AND wt.amount > 0
         ORDER BY wt.created_at DESC
         LIMIT 200`,
        [req.user.id]
      );

      // Calculate total earnings
      const totalEarned = rows.reduce((sum, row) => sum + (row.amount || 0), 0);

      res.json({ earnings: rows, totalEarned });
    } catch (err) {
      console.error('GET /api/history/earnings error:', err);
      res.status(500).json({ error: 'Failed to fetch earnings history' });
    }
  });

   /**
   * GET /api/history/contributions
   * Returns the authenticated user's contributions.
   */
  server.get(PROXY + '/api/history/contributions', authenticateToken, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT wt.id,
                wt.relatedPostId AS postId,
                ABS(wt.amount) AS amount,
                0 AS penaltyAmount,
                0 AS isRefunded,
                wt.created_at,
                d.title AS postTitle,
                COALESCE(d.status, 'completed') AS postStatus
         FROM walletTransactions wt
         LEFT JOIN posts d ON d.id = wt.relatedPostId
         WHERE wt.userId = ? AND (wt.type = 'creator_earning' OR wt.type = 'tip') AND wt.amount < 0
         ORDER BY wt.created_at DESC
         LIMIT 200`,
        [req.user.id]
      );

      // Calculate total contributions
      const totalSpent = rows.reduce((sum, row) => sum + (row.amount || 0), 0);

      res.json({ history: rows, total: rows.length, totalSpent });
    } catch (err) {
      console.error('GET /api/history/contributions error:', err);
      res.status(500).json({ error: 'Failed to fetch contributions history' });
    }
  });


  /**
   * GET /api/history/promo-charges
   * Returns promo deployment charges billed to the authenticated user.
   */
  server.get(PROXY + '/api/history/promo-charges', authenticateToken, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT wt.id, wt.amount, wt.balanceAfter, wt.description, wt.created_at
         FROM walletTransactions wt
         WHERE wt.userId = ?
           AND wt.amount < 0
           AND (wt.type = 'promo_charge' OR wt.description LIKE 'Promo charge%')
         ORDER BY wt.created_at DESC
         LIMIT 200`,
        [req.user.id]
      );

      const totalCharged = rows.reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0);
      res.json({ charges: rows, totalCharged });
    } catch (err) {
      console.error('GET /api/history/promo-charges error:', err);
      res.status(500).json({ error: 'Failed to fetch promo charge history' });
    }
  });

  console.log('✅ Prolifer8 routes loaded')
};
