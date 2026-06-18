-- Prolifer8 — Post favorites
-- Lightweight per-post bookmark tracking.

CREATE TABLE `postFavorites` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `postId` varchar(36) NOT NULL,
  `userId` varchar(10) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_post_fav` (`postId`, `userId`),
  KEY `idx_userId` (`userId`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
