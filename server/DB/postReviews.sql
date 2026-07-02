-- Prolifer8 — Post reviews
-- Formal post reviews with quality and effort ratings.

CREATE TABLE `postReviews` (
  `id` varchar(36) NOT NULL COMMENT 'UUID',
  `postId` varchar(36) NOT NULL,
  `userId` varchar(10) NOT NULL,
  `comment` text NOT NULL,
  `liked` tinyint(1) DEFAULT NULL COMMENT '1=like, 0=dislike, NULL=no vote',
  `rating` tinyint unsigned NOT NULL COMMENT '0-100 quality percentage',
  `effortRating` tinyint unsigned NOT NULL COMMENT '0-100 effort percentage',
  `isEdited` tinyint(1) DEFAULT '0',
  `isHidden` tinyint(1) DEFAULT '0' COMMENT 'Hidden by moderator',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_drop_review` (`postId`, `userId`) COMMENT 'One review per user per drop',
  KEY `idx_postId` (`postId`),
  KEY `idx_userId` (`userId`),
  KEY `idx_qrating` (`rating`),
  KEY `idx_erating` (`effortRating`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
