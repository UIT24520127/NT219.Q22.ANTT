/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19  Distrib 10.11.18-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: drm_system
-- ------------------------------------------------------
-- Server version	10.11.18-MariaDB-ubu2204

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `drm_system`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `drm_system` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci */;

USE `drm_system`;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `action` varchar(50) DEFAULT NULL,
  `user_id` varchar(100) DEFAULT NULL,
  `target_file` varchar(255) DEFAULT NULL,
  `track_id` varchar(36) DEFAULT NULL,
  `kid` varchar(32) DEFAULT NULL,
  `timestamp` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_track_id` (`track_id`),
  KEY `idx_kid` (`kid`),
  KEY `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB AUTO_INCREMENT=45 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` VALUES
(1,'PACKAGE_CREATED','SYSTEM','healing-bg.m4a','ecd84cbd-4840-4546-aee2-45394830c300','3e11212891806bde76b5f02917c67ac9','2026-06-02 18:12:57'),
(2,'LICENSE_ISSUED','SYSTEM','license',NULL,'3e11212891806bde76b5f02917c67ac9','2026-06-02 18:13:02'),
(3,'PACKAGE_CREATED','SYSTEM','Shiba.mp4','1e8e0ac0-0b53-4a8b-9c8d-a5e424056553','5dba30a56045b6fa3b853ae7cc4a39de','2026-06-02 18:13:15'),
(4,'LICENSE_ISSUED','SYSTEM','license',NULL,'3e11212891806bde76b5f02917c67ac9','2026-06-02 18:13:17'),
(5,'LICENSE_ISSUED','SYSTEM','license',NULL,'5dba30a56045b6fa3b853ae7cc4a39de','2026-06-02 18:13:20'),
(6,'LICENSE_ISSUED','SYSTEM','license',NULL,'3e11212891806bde76b5f02917c67ac9','2026-06-02 18:13:56'),
(7,'LICENSE_ISSUED','SYSTEM','license',NULL,'3e11212891806bde76b5f02917c67ac9','2026-06-02 18:14:05'),
(8,'PACKAGE_CREATED','SYSTEM','01. Southern Point.m4a','aac6a8e9-1969-419e-b2df-57f94ff2738a','f43e275b3fcbec702511deaad63768d3','2026-06-02 18:18:49'),
(9,'LICENSE_ISSUED','SYSTEM','license',NULL,'f43e275b3fcbec702511deaad63768d3','2026-06-02 18:18:56'),
(10,'LICENSE_ISSUED','SYSTEM','license',NULL,'3e11212891806bde76b5f02917c67ac9','2026-06-02 18:19:12'),
(11,'LICENSE_ISSUED','SYSTEM','license',NULL,'5dba30a56045b6fa3b853ae7cc4a39de','2026-06-02 18:19:56'),
(12,'PACKAGE_CREATED','SYSTEM','14. Arp Thing.m4a','4eb7e926-60d4-40f7-b634-3ccb60f01186','31d46657cbd283cfab6b54f1fe6dc0f0','2026-06-02 18:21:23'),
(13,'PACKAGE_CREATED','SYSTEM','14. Arp Thing.m4a','9bf79890-f04b-4425-a4af-004dd5ae472b','d608791323cad9064b8fb845e98b738f','2026-06-02 18:22:03'),
(14,'LICENSE_ISSUED','SYSTEM','license',NULL,'d608791323cad9064b8fb845e98b738f','2026-06-02 18:22:15'),
(15,'PACKAGE_CREATED','SYSTEM','13. Shadows of the City.m4a','cc5c98e9-4f04-4994-bf07-e93807e28f60','36cce82a687126ac11751c80e7b835ac','2026-06-02 18:22:56'),
(16,'LICENSE_ISSUED','SYSTEM','license',NULL,'36cce82a687126ac11751c80e7b835ac','2026-06-02 18:23:43'),
(17,'LICENSE_ISSUED','SYSTEM','license',NULL,'3e11212891806bde76b5f02917c67ac9','2026-06-02 18:39:54'),
(18,'LICENSE_ISSUED','SYSTEM','license',NULL,'3e11212891806bde76b5f02917c67ac9','2026-06-02 18:44:11'),
(19,'LICENSE_ISSUED','SYSTEM','license',NULL,'3e11212891806bde76b5f02917c67ac9','2026-06-02 18:44:25'),
(20,'LICENSE_ISSUED','SYSTEM','license',NULL,'d608791323cad9064b8fb845e98b738f','2026-06-02 18:59:25'),
(21,'LICENSE_ISSUED','SYSTEM','license',NULL,'36cce82a687126ac11751c80e7b835ac','2026-06-02 22:03:00'),
(22,'LICENSE_ISSUED','SYSTEM','license',NULL,'d608791323cad9064b8fb845e98b738f','2026-06-02 22:03:09'),
(23,'LICENSE_ISSUED','SYSTEM','license',NULL,'36cce82a687126ac11751c80e7b835ac','2026-06-02 22:04:39'),
(24,'LICENSE_ISSUED','SYSTEM','license',NULL,'3e11212891806bde76b5f02917c67ac9','2026-06-02 22:04:45'),
(25,'LICENSE_ISSUED','SYSTEM','license',NULL,'36cce82a687126ac11751c80e7b835ac','2026-06-03 00:16:06'),
(26,'LICENSE_ISSUED','SYSTEM','license',NULL,'36cce82a687126ac11751c80e7b835ac','2026-06-03 00:16:14'),
(27,'LICENSE_ISSUED','SYSTEM','license',NULL,'d608791323cad9064b8fb845e98b738f','2026-06-03 00:16:55'),
(28,'LICENSE_ISSUED','SYSTEM','license',NULL,'36cce82a687126ac11751c80e7b835ac','2026-06-03 00:17:13'),
(29,'PACKAGE_CREATED','SYSTEM','13. Shadows of the City.m4a','a8562791-e300-47ed-983f-a998d6715cea','442626882b30894f9f139b7b121bb727','2026-06-03 00:24:00'),
(30,'PACKAGE_CREATED','SYSTEM','14. Arp Thing.m4a','fae8c630-776d-4e3b-8282-271491f030e2','9897c426a763a1c1ffb40502c47d956e','2026-06-03 00:24:44'),
(31,'LICENSE_ISSUED','SYSTEM','license',NULL,'9897c426a763a1c1ffb40502c47d956e','2026-06-03 00:27:00'),
(32,'LICENSE_ISSUED','SYSTEM','license',NULL,'9897c426a763a1c1ffb40502c47d956e','2026-06-03 00:27:31'),
(33,'LICENSE_ISSUED','SYSTEM','license',NULL,'9897c426a763a1c1ffb40502c47d956e','2026-06-03 00:43:23'),
(34,'LICENSE_ISSUED','SYSTEM','license',NULL,'9897c426a763a1c1ffb40502c47d956e','2026-06-03 01:06:10'),
(35,'PACKAGE_CREATED','SYSTEM','15. World Citizen.m4a','dc79f221-1d06-4934-a59f-93bd10643599','a3c9423cf2ab5d09e0a73439511764a5','2026-06-03 01:45:05'),
(36,'PACKAGE_CREATED','SYSTEM','11. Saladin.m4a','86b46b55-7a94-464e-b3d0-90771f8ba236','6c490d30b6480e3f66e50a63a1870c43','2026-06-03 01:48:15'),
(37,'LICENSE_ISSUED','SYSTEM','license',NULL,'6c490d30b6480e3f66e50a63a1870c43','2026-06-03 01:48:43'),
(38,'LICENSE_ISSUED','SYSTEM','license',NULL,'6c490d30b6480e3f66e50a63a1870c43','2026-06-03 01:49:00'),
(39,'LICENSE_ISSUED','SYSTEM','license',NULL,'a3c9423cf2ab5d09e0a73439511764a5','2026-06-03 01:50:21'),
(40,'LICENSE_ISSUED','SYSTEM','license',NULL,'442626882b30894f9f139b7b121bb727','2026-06-03 01:51:02'),
(41,'LICENSE_ISSUED','SYSTEM','license',NULL,'6c490d30b6480e3f66e50a63a1870c43','2026-06-03 03:04:12'),
(42,'LICENSE_ISSUED','SYSTEM','license',NULL,'a3c9423cf2ab5d09e0a73439511764a5','2026-06-03 03:04:25'),
(43,'PACKAGE_CREATED','SYSTEM','13. Shadows of the City.m4a','64253a62-1038-46b4-b272-a344f32658f9','a5f01826bfaf4a3824709a1a0756eec8','2026-06-03 04:27:13'),
(44,'PACKAGE_CREATED','SYSTEM','09. The River.m4a','5940d3a8-6997-426c-9c6d-896ac0c3e9e6','72fb1b1b98dd9f69c75694ba87b6cd0f','2026-06-03 04:30:54');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `dash_manifests`
--

DROP TABLE IF EXISTS `dash_manifests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `dash_manifests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `track_id` varchar(36) NOT NULL,
  `mpd_path` varchar(255) NOT NULL,
  `manifest_data` longtext DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_track_id` (`track_id`),
  KEY `idx_is_active` (`is_active`),
  CONSTRAINT `dash_manifests_ibfk_1` FOREIGN KEY (`track_id`) REFERENCES `tracks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `dash_manifests`
--

LOCK TABLES `dash_manifests` WRITE;
/*!40000 ALTER TABLE `dash_manifests` DISABLE KEYS */;
INSERT INTO `dash_manifests` VALUES
(1,'a8562791-e300-47ed-983f-a998d6715cea','public/audio/segments/a8562791-e300-47ed-983f-a998d6715cea/manifest.mpd',NULL,1,'2026-06-03 00:24:00','2026-06-03 00:24:00'),
(2,'fae8c630-776d-4e3b-8282-271491f030e2','public/audio/segments/fae8c630-776d-4e3b-8282-271491f030e2/manifest.mpd',NULL,1,'2026-06-03 00:24:44','2026-06-03 00:24:44'),
(3,'dc79f221-1d06-4934-a59f-93bd10643599','public/audio/segments/dc79f221-1d06-4934-a59f-93bd10643599/manifest.mpd',NULL,1,'2026-06-03 01:45:05','2026-06-03 01:45:05'),
(4,'86b46b55-7a94-464e-b3d0-90771f8ba236','public/audio/segments/86b46b55-7a94-464e-b3d0-90771f8ba236/manifest.mpd',NULL,1,'2026-06-03 01:48:15','2026-06-03 01:48:15'),
(5,'64253a62-1038-46b4-b272-a344f32658f9','public/audio/segments/64253a62-1038-46b4-b272-a344f32658f9/manifest.mpd',NULL,1,'2026-06-03 04:27:13','2026-06-03 04:27:13'),
(6,'5940d3a8-6997-426c-9c6d-896ac0c3e9e6','public/audio/segments/5940d3a8-6997-426c-9c6d-896ac0c3e9e6/manifest.mpd',NULL,1,'2026-06-03 04:30:54','2026-06-03 04:30:54');
/*!40000 ALTER TABLE `dash_manifests` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tracks`
--

DROP TABLE IF EXISTS `tracks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tracks` (
  `id` varchar(36) NOT NULL,
  `filename` varchar(255) NOT NULL,
  `duration` int(11) DEFAULT 0,
  `kid` varchar(32) NOT NULL,
  `encrypted_cek` text NOT NULL,
  `source_format` varchar(20) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `kid` (`kid`),
  KEY `idx_kid` (`kid`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tracks`
--

LOCK TABLES `tracks` WRITE;
/*!40000 ALTER TABLE `tracks` DISABLE KEYS */;
INSERT INTO `tracks` VALUES
('5940d3a8-6997-426c-9c6d-896ac0c3e9e6','09. The River.m4a',217,'72fb1b1b98dd9f69c75694ba87b6cd0f','vault:v1:zuYg7Lk2GEJ5vO2VCGgOHEYzlBFqqipW6qOh/YlOffbh0fehZiC8MM8hpb7f+hkmRleocult4GxKKwQu','M4A','2026-06-03 04:30:49','2026-06-03 04:30:54'),
('64253a62-1038-46b4-b272-a344f32658f9','13. Shadows of the City.m4a',554,'a5f01826bfaf4a3824709a1a0756eec8','vault:v1:SjV/ybyvV6KIlaQIyh6PcNbCxkHgWB3bmBigQKveDHaRm+fr3XBd6aqbbdDwlABP0v1QcWkhd/uTwOTT','M4A','2026-06-03 04:27:01','2026-06-03 04:27:13'),
('86b46b55-7a94-464e-b3d0-90771f8ba236','11. Saladin.m4a',328,'6c490d30b6480e3f66e50a63a1870c43','vault:v1:EM5LAPaFRDE/IYAAtk2xbxJDcThdiMRJO3TUIEM/XkDiR8hMYrK/waZ+cKgLIdgMBV2g62dFlfI3DLTb','M4A','2026-06-03 01:48:08','2026-06-03 01:48:15'),
('a8562791-e300-47ed-983f-a998d6715cea','13. Shadows of the City.m4a',554,'442626882b30894f9f139b7b121bb727','vault:v1:9LjwIR7HeCKSTYayMhas0U7qAIxY/2pSC5KMCT3gMvSK9FhdQc7Nrut5FqBtxYF4vU+HtWWHmJfWBAyy','M4A','2026-06-03 00:23:50','2026-06-03 00:24:00'),
('dc79f221-1d06-4934-a59f-93bd10643599','15. World Citizen.m4a',412,'a3c9423cf2ab5d09e0a73439511764a5','vault:v1:LEHvNPSn6mN0Bb7d7R+iWzia5u9Apas+QaTbItLZMyMq0dZXi8hC/DTCjL3hJs5WLcx9Qu9MYFSul04k','M4A','2026-06-03 01:44:55','2026-06-03 01:45:05'),
('fae8c630-776d-4e3b-8282-271491f030e2','14. Arp Thing.m4a',104,'9897c426a763a1c1ffb40502c47d956e','vault:v1:TAdkNjvEYiM8viGYk9FU0D97rehj/1Us5iUJEFKHWvX9thTzxyclzvl7P4/+92flNwt8Bp+6LvadD0V+','M4A','2026-06-03 00:24:41','2026-06-03 00:24:44');
/*!40000 ALTER TABLE `tracks` ENABLE KEYS */;
UNLOCK TABLES;
