-- Normalize boostCampaignBalances to the UUID schema expected by server routes.
-- Safe to run on MySQL 8.x.

START TRANSACTION;

-- Remove accidental/legacy column if present.
ALTER TABLE boostCampaignBalances
  DROP COLUMN IF EXISTS column_6;

-- Convert id from INT AUTO_INCREMENT to UUID text key expected by app inserts.
ALTER TABLE boostCampaignBalances
  DROP PRIMARY KEY,
  MODIFY COLUMN id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  ADD PRIMARY KEY (id);

-- Align business columns with current app contract.
ALTER TABLE boostCampaignBalances
  MODIFY COLUMN boostId VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN postId VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN userId VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  MODIFY COLUMN initialBalance INT UNSIGNED NOT NULL,
  MODIFY COLUMN currentBalance INT UNSIGNED NOT NULL,
  MODIFY COLUMN totalSpent INT UNSIGNED NOT NULL DEFAULT 0,
  MODIFY COLUMN status ENUM('active', 'completed', 'cancelled') NOT NULL DEFAULT 'active',
  MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Add indexes if they do not already exist.
SET @has_idx_boostId := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'boostCampaignBalances'
    AND index_name = 'idx_boostCampaignBalances_boostId'
);
SET @sql := IF(@has_idx_boostId = 0,
  'ALTER TABLE boostCampaignBalances ADD INDEX idx_boostCampaignBalances_boostId (boostId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_postId := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'boostCampaignBalances'
    AND index_name = 'idx_boostCampaignBalances_postId'
);
SET @sql := IF(@has_idx_postId = 0,
  'ALTER TABLE boostCampaignBalances ADD INDEX idx_boostCampaignBalances_postId (postId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_userId := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'boostCampaignBalances'
    AND index_name = 'idx_boostCampaignBalances_userId'
);
SET @sql := IF(@has_idx_userId = 0,
  'ALTER TABLE boostCampaignBalances ADD INDEX idx_boostCampaignBalances_userId (userId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_status := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'boostCampaignBalances'
    AND index_name = 'idx_boostCampaignBalances_status'
);
SET @sql := IF(@has_idx_status = 0,
  'ALTER TABLE boostCampaignBalances ADD INDEX idx_boostCampaignBalances_status (status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add expected foreign keys if missing.
SET @has_fk_boost := (
  SELECT COUNT(*)
  FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'boostCampaignBalances'
    AND constraint_name = 'fk_boostCampaignBalances_boostId'
);
SET @sql := IF(@has_fk_boost = 0,
  'ALTER TABLE boostCampaignBalances ADD CONSTRAINT fk_boostCampaignBalances_boostId FOREIGN KEY (boostId) REFERENCES postBoosts(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk_post := (
  SELECT COUNT(*)
  FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'boostCampaignBalances'
    AND constraint_name = 'fk_boostCampaignBalances_postId'
);
SET @sql := IF(@has_fk_post = 0,
  'ALTER TABLE boostCampaignBalances ADD CONSTRAINT fk_boostCampaignBalances_postId FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk_user := (
  SELECT COUNT(*)
  FROM information_schema.referential_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'boostCampaignBalances'
    AND constraint_name = 'fk_boostCampaignBalances_userId'
);
SET @sql := IF(@has_fk_user = 0,
  'ALTER TABLE boostCampaignBalances ADD CONSTRAINT fk_boostCampaignBalances_userId FOREIGN KEY (userId) REFERENCES userData(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

COMMIT;
