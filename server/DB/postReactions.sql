-- Prolifer8 — Per-post reactions
-- Stores one like/dislike vote per user per post.

CREATE TABLE `postReactions` (
  `id` varchar(36) NOT NULL COMMENT 'UUID',
  `postId` varchar(36) NOT NULL,
  `userId` varchar(64) NOT NULL,
  `reaction` enum('like', 'dislike') NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_post_reaction` (`postId`, `userId`),
  KEY `idx_post_reactions_post` (`postId`),
  KEY `idx_post_reactions_user` (`userId`),
  CONSTRAINT `fk_post_reactions_post` FOREIGN KEY (`postId`) REFERENCES `posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_post_reactions_user` FOREIGN KEY (`userId`) REFERENCES `userData` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
