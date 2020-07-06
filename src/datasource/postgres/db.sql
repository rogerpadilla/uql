-- -----------------------------------------------------
-- Schema abakus
-- -----------------------------------------------------
-- -----------------------------------------------------
-- Table `User`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `User`;

CREATE TABLE IF NOT EXISTS `User` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(300) NOT NULL,
    `password` VARCHAR(300) NOT NULL,
    `name` VARCHAR(45) NOT NULL,
    `createdAt` BIGINT(12) UNSIGNED NOT NULL,
    `updatedAt` BIGINT(12) UNSIGNED NULL,
    `user` INT UNSIGNED NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `id_UNIQUE` (`id` ASC) VISIBLE,
    INDEX `fk_User_User1_idx` (`user` ASC) VISIBLE,
    CONSTRAINT `fk_User_User1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- -----------------------------------------------------
-- Table `Company`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `Company`;

CREATE TABLE IF NOT EXISTS `Company` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `createdAt` BIGINT(12) NULL,
    `updatedAt` BIGINT(12) NULL,
    `user` INT UNSIGNED NOT NULL,
    `company` INT UNSIGNED NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_empresa_usuario1_idx` (`user` ASC) VISIBLE,
    INDEX `fk_Company_Company1_idx` (`company` ASC) VISIBLE,
    CONSTRAINT `fk_empresa_usuario1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_Company_Company1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `LedgerAccount`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `LedgerAccount`;

CREATE TABLE IF NOT EXISTS `LedgerAccount` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `description` VARCHAR(45) NULL,
    `createdAt` BIGINT(12) UNSIGNED NOT NULL,
    `updatedAt` BIGINT(12) UNSIGNED NULL,
    `parent` INT UNSIGNED NULL,
    `company` INT UNSIGNED NOT NULL,
    `user` INT UNSIGNED NOT NULL,
    `country` CHAR(2) NULL,
    `niif` INT UNSIGNED NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_cuenta_contable_cuenta_contable1_idx` (`parent` ASC) VISIBLE,
    INDEX `fk_cuenta_contable_empresa1_idx` (`company` ASC) VISIBLE,
    INDEX `fk_LedgerAccount_LedgerAccount1_idx` (`niif` ASC) VISIBLE,
    INDEX `fk_LedgerAccount_User1_idx` (`user` ASC) VISIBLE,
    CONSTRAINT `fk_cuenta_contable_cuenta_contable1` FOREIGN KEY (`parent`) REFERENCES `LedgerAccount` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_cuenta_contable_empresa1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_LedgerAccount_LedgerAccount1` FOREIGN KEY (`niif`) REFERENCES `LedgerAccount` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_LedgerAccount_User1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `TaxCategory`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `TaxCategory`;

CREATE TABLE IF NOT EXISTS `TaxCategory` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `description` VARCHAR(300) NULL,
    `createdAt` BIGINT(12) UNSIGNED NOT NULL,
    `updatedAt` BIGINT(12) UNSIGNED NULL,
    `company` INT UNSIGNED NOT NULL,
    `user` INT UNSIGNED NOT NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `tipo_impuestocol_UNIQUE` (`updatedAt` ASC) VISIBLE,
    INDEX `fk_tipo_impuesto_empresa2_idx` (`company` ASC) VISIBLE,
    INDEX `fk_TaxCategory_User1_idx` (`user` ASC) VISIBLE,
    CONSTRAINT `fk_tipo_impuesto_empresa2` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_TaxCategory_User1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `Tax`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `Tax`;

CREATE TABLE IF NOT EXISTS `Tax` (
    `id` INT UNSIGNED NOT NULL,
    `name` VARCHAR(45) NOT NULL,
    `percentage` DOUBLE UNSIGNED NOT NULL,
    `description` VARCHAR(300) NULL,
    `createdAt` BIGINT(12) UNSIGNED NOT NULL,
    `updatedAt` BIGINT(12) UNSIGNED NULL,
    `category` INT UNSIGNED NOT NULL,
    `user` INT UNSIGNED NOT NULL,
    `company` INT UNSIGNED NOT NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_impuesto_tipo_impuesto_idx` (`category` ASC) VISIBLE,
    INDEX `fk_impuesto_usuario1_idx` (`user` ASC) VISIBLE,
    INDEX `fk_impuesto_empresa1_idx` (`company` ASC) VISIBLE,
    CONSTRAINT `fk_impuesto_tipo_impuesto` FOREIGN KEY (`category`) REFERENCES `TaxCategory` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_impuesto_usuario1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_impuesto_empresa1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `MeasureUnitCategory`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `MeasureUnitCategory`;

CREATE TABLE IF NOT EXISTS `MeasureUnitCategory` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `company` INT UNSIGNED NOT NULL,
    `user` INT UNSIGNED NOT NULL,
    `createdAt` BIGINT(12) UNSIGNED NOT NULL,
    `updatedAt` BIGINT(12) UNSIGNED NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `nombre_UNIQUE` (`name` ASC) VISIBLE,
    INDEX `fk_UnidadMedidaCategoria_empresa1_idx` (`company` ASC) VISIBLE,
    INDEX `fk_MeasureUnitCategory_User1_idx` (`user` ASC) VISIBLE,
    CONSTRAINT `fk_UnidadMedidaCategoria_empresa1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_MeasureUnitCategory_User1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `MeasureUnit`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `MeasureUnit`;

CREATE TABLE IF NOT EXISTS `MeasureUnit` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `category` INT UNSIGNED NOT NULL,
    `company` INT UNSIGNED NOT NULL,
    `user` INT UNSIGNED NOT NULL,
    `createdAt` BIGINT(12) NULL,
    `updatedAt` BIGINT(12) NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_UnidadMedida_UnidadMedidaCategoria1_idx` (`category` ASC) VISIBLE,
    UNIQUE INDEX `nombre_UNIQUE` (`name` ASC) VISIBLE,
    INDEX `fk_UnidadMedida_empresa1_idx` (`company` ASC) VISIBLE,
    INDEX `fk_MeasureUnit_User1_idx` (`user` ASC) VISIBLE,
    CONSTRAINT `fk_UnidadMedida_UnidadMedidaCategoria1` FOREIGN KEY (`category`) REFERENCES `MeasureUnitCategory` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_UnidadMedida_empresa1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_MeasureUnit_User1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `Item`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `Item`;

CREATE TABLE IF NOT EXISTS `Item` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `buyPrice` DOUBLE UNSIGNED NULL,
    `buyPriceAverage` DOUBLE UNSIGNED NULL,
    `description` VARCHAR(45) NULL,
    `code` VARCHAR(30) NULL,
    `barcode` VARCHAR(30) NULL,
    `image` VARCHAR(300) NULL,
    `createdAt` BIGINT(12) UNSIGNED NOT NULL,
    `updatedAt` BIGINT(12) UNSIGNED NULL,
    `user` INT UNSIGNED NOT NULL,
    `buyLedgerAccount` INT UNSIGNED NOT NULL,
    `saleLedgerAccount` INT UNSIGNED NOT NULL,
    `tax` INT UNSIGNED NOT NULL,
    `company` INT UNSIGNED NOT NULL,
    `measureUnit` INT UNSIGNED NOT NULL,
    `existence` INT NULL,
    `salePrice` DOUBLE UNSIGNED NULL,
    `inventoryable` TINYINT(1) UNSIGNED NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_producto_usuario1_idx` (`user` ASC) VISIBLE,
    INDEX `fk_producto_cuenta_contable1_idx` (`saleLedgerAccount` ASC) VISIBLE,
    INDEX `fk_producto_impuesto1_idx` (`tax` ASC) VISIBLE,
    INDEX `fk_producto_empresa1_idx` (`company` ASC) VISIBLE,
    INDEX `fk_producto_UnidadMedida1_idx` (`measureUnit` ASC) VISIBLE,
    INDEX `fk_Item_LedgerAccount1_idx` (`buyLedgerAccount` ASC) VISIBLE,
    UNIQUE INDEX `uk_Item_nombre` (`name` ASC, `company` ASC) VISIBLE,
    FULLTEXT INDEX `ft_Item_name` (`name`) VISIBLE,
    CONSTRAINT `fk_producto_usuario1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_producto_cuenta_contable1` FOREIGN KEY (`saleLedgerAccount`) REFERENCES `LedgerAccount` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_producto_impuesto1` FOREIGN KEY (`tax`) REFERENCES `Tax` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_producto_empresa1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_producto_UnidadMedida1` FOREIGN KEY (`measureUnit`) REFERENCES `MeasureUnit` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_Item_LedgerAccount1` FOREIGN KEY (`buyLedgerAccount`) REFERENCES `LedgerAccount` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `Storehouse`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `Storehouse`;

CREATE TABLE IF NOT EXISTS `Storehouse` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `address` VARCHAR(300) NULL,
    `description` VARCHAR(300) NULL,
    `createdAt` BIGINT(12) UNSIGNED NOT NULL,
    `updatedAt` BIGINT(12) UNSIGNED NULL,
    `user` INT UNSIGNED NOT NULL,
    `company` INT UNSIGNED NOT NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_bodega_usuario1_idx` (`user` ASC) VISIBLE,
    INDEX `fk_bodega_empresa1_idx` (`company` ASC) VISIBLE,
    CONSTRAINT `fk_bodega_usuario1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_bodega_empresa1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `InventoryAdjustment`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `InventoryAdjustment`;

CREATE TABLE IF NOT EXISTS `InventoryAdjustment` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `createdAt` BIGINT(12) UNSIGNED NOT NULL,
    `updatedAt` BIGINT(12) UNSIGNED NULL,
    `company` INT UNSIGNED NOT NULL,
    `user` INT UNSIGNED NOT NULL,
    `status` TINYINT(1) UNSIGNED NULL,
    `date` BIGINT(12) UNSIGNED NOT NULL,
    `description` VARCHAR(250) NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_DocumentAdjustment_Company1_idx` (`company` ASC) VISIBLE,
    INDEX `fk_DocumentAdjustment_User1_idx` (`user` ASC) VISIBLE,
    CONSTRAINT `fk_DocumentAdjustment_Company1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_DocumentAdjustment_User1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `ItemAdjustment`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `ItemAdjustment`;

CREATE TABLE IF NOT EXISTS `ItemAdjustment` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `number` INT NOT NULL,
    `buyPrice` DOUBLE UNSIGNED NOT NULL,
    `location` VARCHAR(300) NULL,
    `expirationDate` BIGINT(12) UNSIGNED NULL,
    `lot` VARCHAR(45) NULL,
    `createdAt` BIGINT(12) UNSIGNED NOT NULL,
    `updatedAt` BIGINT(12) UNSIGNED NULL,
    `item` INT UNSIGNED NOT NULL,
    `company` INT UNSIGNED NOT NULL,
    `storehouse` INT UNSIGNED NOT NULL,
    `user` INT UNSIGNED NOT NULL,
    `status` TINYINT NULL,
    `description` VARCHAR(200) NULL,
    `inventoryAdjustment` INT UNSIGNED NOT NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_ajuste_inventario_usuario1_idx` (`user` ASC) VISIBLE,
    INDEX `fk_ajuste_inventario_empresa1_idx` (`company` ASC) VISIBLE,
    INDEX `fk_movimiento_producto_bodega1_idx` (`storehouse` ASC) VISIBLE,
    INDEX `fk_ItemMovement_Item1_idx` (`item` ASC) VISIBLE,
    INDEX `fk_ItemAdjustment_DocumentAdjustment1_idx` (`inventoryAdjustment` ASC) VISIBLE,
    CONSTRAINT `fk_ajuste_inventario_usuario1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_ajuste_inventario_empresa1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_movimiento_producto_bodega1` FOREIGN KEY (`storehouse`) REFERENCES `Storehouse` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_ItemMovement_Item1` FOREIGN KEY (`item`) REFERENCES `Item` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_ItemAdjustment_DocumentAdjustment1` FOREIGN KEY (`inventoryAdjustment`) REFERENCES `InventoryAdjustment` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `Role`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `Role`;

CREATE TABLE IF NOT EXISTS `Role` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `description` VARCHAR(200) NULL,
    `company` INT UNSIGNED NOT NULL,
    `user` INT UNSIGNED NOT NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_Role_Company1_idx` (`company` ASC) VISIBLE,
    INDEX `fk_Role_User1_idx` (`user` ASC) VISIBLE,
    CONSTRAINT `fk_Role_Company1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_Role_User1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `User_has_Company`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `User_has_Company`;

CREATE TABLE IF NOT EXISTS `User_has_Company` (
    `user` INT UNSIGNED NOT NULL,
    `company` INT UNSIGNED NOT NULL,
    `status` TINYINT NULL,
    `role` INT UNSIGNED NOT NULL,
    `createdAt` BIGINT(12) UNSIGNED NOT NULL,
    `updatedAt` BIGINT(12) UNSIGNED NULL,
    PRIMARY KEY (`user`, `company`),
    INDEX `fk_User_has_Company_Company1_idx` (`company` ASC) VISIBLE,
    INDEX `fk_User_has_Company_User1_idx` (`user` ASC) VISIBLE,
    INDEX `fk_User_has_Company_Role1_idx` (`role` ASC) VISIBLE,
    CONSTRAINT `fk_User_has_Company_User1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_User_has_Company_Company1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_User_has_Company_Role1` FOREIGN KEY (`role`) REFERENCES `Role` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `ItemCategory`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `ItemCategory`;

CREATE TABLE IF NOT EXISTS `ItemCategory` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `inventoryable` TINYINT(1) UNSIGNED NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `PriceList`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `PriceList`;

CREATE TABLE IF NOT EXISTS `PriceList` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `type` VARCHAR(10) NOT NULL,
    `company` INT UNSIGNED NOT NULL,
    `user` INT UNSIGNED NOT NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_PriceList_Company1_idx` (`company` ASC) VISIBLE,
    INDEX `fk_PriceList_User1_idx` (`user` ASC) VISIBLE,
    CONSTRAINT `fk_PriceList_Company1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_PriceList_User1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `NationalIdType`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `NationalIdType`;

CREATE TABLE IF NOT EXISTS `NationalIdType` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `shortName` VARCHAR(5) NOT NULL,
    `company` INT UNSIGNED NOT NULL,
    `user` INT UNSIGNED NOT NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_NationalIdType_Company1_idx` (`company` ASC) VISIBLE,
    INDEX `fk_NationalIdType_User1_idx` (`user` ASC) VISIBLE,
    CONSTRAINT `fk_NationalIdType_Company1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_NationalIdType_User1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `Contact`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `Contact`;

CREATE TABLE IF NOT EXISTS `Contact` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `isCustomer` TINYINT(1) UNSIGNED NULL,
    `isProvider` TINYINT(1) UNSIGNED NULL,
    `createdAt` BIGINT(12) UNSIGNED NOT NULL,
    `updatedAt` BIGINT(12) UNSIGNED NULL,
    `user` INT UNSIGNED NOT NULL,
    `company` INT UNSIGNED NOT NULL,
    `status` TINYINT NULL,
    `nationalId` VARCHAR(20) NOT NULL,
    `address` VARCHAR(45) NULL,
    `cellphone` VARCHAR(45) NULL,
    `phone1` VARCHAR(45) NULL,
    `phone2` VARCHAR(45) NULL,
    `fax` VARCHAR(45) NULL,
    `priceList` INT UNSIGNED NULL,
    `nationalIdType` INT UNSIGNED NOT NULL,
    `email` VARCHAR(300) NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_Contact_User1_idx` (`user` ASC) VISIBLE,
    INDEX `fk_Contact_Company1_idx` (`company` ASC) VISIBLE,
    INDEX `fk_Contact_PriceList1_idx` (`priceList` ASC) VISIBLE,
    INDEX `fk_Contact_NationalIdType1_idx` (`nationalIdType` ASC) VISIBLE,
    CONSTRAINT `fk_Contact_User1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_Contact_Company1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_Contact_PriceList1` FOREIGN KEY (`priceList`) REFERENCES `PriceList` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_Contact_NationalIdType1` FOREIGN KEY (`nationalIdType`) REFERENCES `NationalIdType` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `Permission`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `Permission`;

CREATE TABLE IF NOT EXISTS `Permission` (
    `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(45) NOT NULL,
    `user` INT UNSIGNED NOT NULL,
    `company` INT UNSIGNED NOT NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`id`),
    INDEX `fk_Permission_User1_idx` (`user` ASC) VISIBLE,
    INDEX `fk_Permission_Company1_idx` (`company` ASC) VISIBLE,
    CONSTRAINT `fk_Permission_User1` FOREIGN KEY (`user`) REFERENCES `User` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_Permission_Company1` FOREIGN KEY (`company`) REFERENCES `Company` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

-- -----------------------------------------------------
-- Table `Role_has_Permission`
-- -----------------------------------------------------
DROP TABLE IF EXISTS `Role_has_Permission`;

CREATE TABLE IF NOT EXISTS `Role_has_Permission` (
    `role` INT UNSIGNED NOT NULL,
    `permission` INT UNSIGNED NOT NULL,
    `status` TINYINT NULL,
    PRIMARY KEY (`role`, `permission`),
    INDEX `fk_Role_has_Permission_Permission1_idx` (`permission` ASC) VISIBLE,
    INDEX `fk_Role_has_Permission_Role1_idx` (`role` ASC) VISIBLE,
    CONSTRAINT `fk_Role_has_Permission_Role1` FOREIGN KEY (`role`) REFERENCES `Role` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT `fk_Role_has_Permission_Permission1` FOREIGN KEY (`permission`) REFERENCES `Permission` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE = InnoDB;

SET
    SQL_MODE = @OLD_SQL_MODE;

SET
    FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

SET
    UNIQUE_CHECKS = @OLD_UNIQUE_CHECKS;

-- -----------------------------------------------------
-- Data for table `User`
-- -----------------------------------------------------
START TRANSACTION;

INSERT INTO
    `User` (
        `id`,
        `email`,
        `password`,
        `name`,
        `createdAt`,
        `updatedAt`,
        `user`,
        `status`
    )
VALUES
    (
        1,
        'rogerjose81@gmail.com',
        'abc',
        'rpc',
        1,
        NULL,
        NULL,
        NULL
    );

COMMIT;

-- -----------------------------------------------------
-- Data for table `Company`
-- -----------------------------------------------------
START TRANSACTION;

INSERT INTO
    `Company` (
        `id`,
        `name`,
        `createdAt`,
        `updatedAt`,
        `user`,
        `company`,
        `status`
    )
VALUES
    (1, 'abakus', 1, NULL, 1, NULL, NULL);

COMMIT;

-- -----------------------------------------------------
-- Data for table `LedgerAccount`
-- -----------------------------------------------------
START TRANSACTION;

INSERT INTO
    `LedgerAccount` (
        `id`,
        `name`,
        `description`,
        `createdAt`,
        `updatedAt`,
        `parent`,
        `company`,
        `user`,
        `country`,
        `niif`,
        `status`
    )
VALUES
    (
        1,
        'Ventas',
        NULL,
        1,
        NULL,
        NULL,
        1,
        1,
        NULL,
        NULL,
        NULL
    );

COMMIT;

-- -----------------------------------------------------
-- Data for table `TaxCategory`
-- -----------------------------------------------------
START TRANSACTION;

INSERT INTO
    `TaxCategory` (
        `id`,
        `name`,
        `description`,
        `createdAt`,
        `updatedAt`,
        `company`,
        `user`,
        `status`
    )
VALUES
    (1, 'IVA', NULL, 1, NULL, 1, 1, NULL);

INSERT INTO
    `TaxCategory` (
        `id`,
        `name`,
        `description`,
        `createdAt`,
        `updatedAt`,
        `company`,
        `user`,
        `status`
    )
VALUES
    (2, 'ICO', NULL, 1, NULL, 1, 1, NULL);

INSERT INTO
    `TaxCategory` (
        `id`,
        `name`,
        `description`,
        `createdAt`,
        `updatedAt`,
        `company`,
        `user`,
        `status`
    )
VALUES
    (3, 'Otro', NULL, 1, NULL, 1, 1, NULL);

COMMIT;

-- -----------------------------------------------------
-- Data for table `Tax`
-- -----------------------------------------------------
START TRANSACTION;

INSERT INTO
    `Tax` (
        `id`,
        `name`,
        `percentage`,
        `description`,
        `createdAt`,
        `updatedAt`,
        `category`,
        `user`,
        `company`,
        `status`
    )
VALUES
    (1, 'IVA 0%', 0, NULL, 1, NULL, 1, 1, 1, NULL);

INSERT INTO
    `Tax` (
        `id`,
        `name`,
        `percentage`,
        `description`,
        `createdAt`,
        `updatedAt`,
        `category`,
        `user`,
        `company`,
        `status`
    )
VALUES
    (2, 'IVA 5%', 5, NULL, 2, NULL, 1, 1, 1, NULL);

INSERT INTO
    `Tax` (
        `id`,
        `name`,
        `percentage`,
        `description`,
        `createdAt`,
        `updatedAt`,
        `category`,
        `user`,
        `company`,
        `status`
    )
VALUES
    (3, 'IVA 19%', 19, NULL, 3, NULL, 1, 1, 1, NULL);

COMMIT;

-- -----------------------------------------------------
-- Data for table `MeasureUnitCategory`
-- -----------------------------------------------------
START TRANSACTION;

INSERT INTO
    `MeasureUnitCategory` (
        `id`,
        `name`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (1, 'Unidad', 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnitCategory` (
        `id`,
        `name`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (2, 'Longitud', 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnitCategory` (
        `id`,
        `name`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (3, 'Área', 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnitCategory` (
        `id`,
        `name`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (4, 'Volumen', 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnitCategory` (
        `id`,
        `name`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (5, 'Peso', 1, 1, 1, NULL, NULL);

COMMIT;

-- -----------------------------------------------------
-- Data for table `MeasureUnit`
-- -----------------------------------------------------
START TRANSACTION;

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (DEFAULT, 'Unidad', 1, 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (DEFAULT, 'Servicio', 1, 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (DEFAULT, 'Centímetro', 2, 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (DEFAULT, 'Metro', 2, 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (DEFAULT, 'Pulgada', 2, 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (DEFAULT, 'Pie', 2, 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (
        DEFAULT,
        'Centímetro Cuadrado',
        3,
        1,
        1,
        1,
        NULL,
        NULL
    );

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (
        DEFAULT,
        'Metro Cuadrado',
        3,
        1,
        1,
        1,
        NULL,
        NULL
    );

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (
        DEFAULT,
        'Pulgada Cuadrada',
        3,
        1,
        1,
        1,
        NULL,
        NULL
    );

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (
        DEFAULT,
        'Mililitro (mL)',
        4,
        1,
        1,
        1,
        NULL,
        NULL
    );

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (DEFAULT, 'Litro (L)', 4, 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (DEFAULT, 'Galón', 4, 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (DEFAULT, 'Gramo (g)', 5, 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (
        DEFAULT,
        'Kilogramo (Kg)',
        5,
        1,
        1,
        1,
        NULL,
        NULL
    );

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (DEFAULT, 'Libra', 5, 1, 1, 1, NULL, NULL);

INSERT INTO
    `MeasureUnit` (
        `id`,
        `name`,
        `category`,
        `company`,
        `user`,
        `createdAt`,
        `updatedAt`,
        `status`
    )
VALUES
    (DEFAULT, 'Tonelada', 5, 1, 1, 1, NULL, NULL);

COMMIT;

-- -----------------------------------------------------
-- Data for table `Item`
-- -----------------------------------------------------
START TRANSACTION;

INSERT INTO
    `Item` (
        `id`,
        `name`,
        `buyPrice`,
        `buyPriceAverage`,
        `description`,
        `code`,
        `barcode`,
        `image`,
        `createdAt`,
        `updatedAt`,
        `user`,
        `buyLedgerAccount`,
        `saleLedgerAccount`,
        `tax`,
        `company`,
        `measureUnit`,
        `existence`,
        `salePrice`,
        `inventoryable`,
        `status`
    )
VALUES
    (
        1,
        'Panela Colombia x 6',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        1,
        NULL,
        1,
        1,
        1,
        1,
        1,
        1,
        NULL,
        NULL,
        1,
        NULL
    );

INSERT INTO
    `Item` (
        `id`,
        `name`,
        `buyPrice`,
        `buyPriceAverage`,
        `description`,
        `code`,
        `barcode`,
        `image`,
        `createdAt`,
        `updatedAt`,
        `user`,
        `buyLedgerAccount`,
        `saleLedgerAccount`,
        `tax`,
        `company`,
        `measureUnit`,
        `existence`,
        `salePrice`,
        `inventoryable`,
        `status`
    )
VALUES
    (
        2,
        'Arepa de Yuca y Queso x 6',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        1,
        NULL,
        1,
        1,
        1,
        1,
        1,
        1,
        NULL,
        NULL,
        1,
        NULL
    );

INSERT INTO
    `Item` (
        `id`,
        `name`,
        `buyPrice`,
        `buyPriceAverage`,
        `description`,
        `code`,
        `barcode`,
        `image`,
        `createdAt`,
        `updatedAt`,
        `user`,
        `buyLedgerAccount`,
        `saleLedgerAccount`,
        `tax`,
        `company`,
        `measureUnit`,
        `existence`,
        `salePrice`,
        `inventoryable`,
        `status`
    )
VALUES
    (
        3,
        'Queso Parmesano Colanta x 500 gr',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        1,
        NULL,
        1,
        1,
        1,
        1,
        1,
        1,
        NULL,
        NULL,
        1,
        NULL
    );

COMMIT;

-- -----------------------------------------------------
-- Data for table `Storehouse`
-- -----------------------------------------------------
START TRANSACTION;

INSERT INTO
    `Storehouse` (
        `id`,
        `name`,
        `address`,
        `description`,
        `createdAt`,
        `updatedAt`,
        `user`,
        `company`,
        `status`
    )
VALUES
    (1, 'Principal', NULL, NULL, 1, NULL, 1, 1, NULL);

INSERT INTO
    `Storehouse` (
        `id`,
        `name`,
        `address`,
        `description`,
        `createdAt`,
        `updatedAt`,
        `user`,
        `company`,
        `status`
    )
VALUES
    (2, 'Auxiliar', NULL, NULL, 1, NULL, 1, 1, NULL);

COMMIT;

-- -----------------------------------------------------
-- Data for table `NationalIdType`
-- -----------------------------------------------------
START TRANSACTION;

INSERT INTO
    `NationalIdType` (
        `id`,
        `name`,
        `shortName`,
        `company`,
        `user`,
        `status`
    )
VALUES
    (1, 'Cédula de Ciudadanía', 'CC', 1, 1, NULL);

INSERT INTO
    `NationalIdType` (
        `id`,
        `name`,
        `shortName`,
        `company`,
        `user`,
        `status`
    )
VALUES
    (
        2,
        'Número de Identificación Tributaria',
        'NIT',
        1,
        1,
        NULL
    );

INSERT INTO
    `NationalIdType` (
        `id`,
        `name`,
        `shortName`,
        `company`,
        `user`,
        `status`
    )
VALUES
    (
        3,
        'Documento de Identificación Extrajero',
        'DIE',
        1,
        1,
        NULL
    );

INSERT INTO
    `NationalIdType` (
        `id`,
        `name`,
        `shortName`,
        `company`,
        `user`,
        `status`
    )
VALUES
    (4, 'Pasaporte', 'PP', 1, 1, NULL);

INSERT INTO
    `NationalIdType` (
        `id`,
        `name`,
        `shortName`,
        `company`,
        `user`,
        `status`
    )
VALUES
    (5, 'Cédula de Extranjería', 'CE', 1, 1, NULL);

INSERT INTO
    `NationalIdType` (
        `id`,
        `name`,
        `shortName`,
        `company`,
        `user`,
        `status`
    )
VALUES
    (6, 'Tarjeta de Extranjería', 'TE', 1, 1, NULL);

INSERT INTO
    `NationalIdType` (
        `id`,
        `name`,
        `shortName`,
        `company`,
        `user`,
        `status`
    )
VALUES
    (7, 'Tarjeta de Identidad', 'TI', 1, 1, NULL);

INSERT INTO
    `NationalIdType` (
        `id`,
        `name`,
        `shortName`,
        `company`,
        `user`,
        `status`
    )
VALUES
    (DEFAULT, 'Registro Civil', 'RC', 1, 1, NULL);

COMMIT;







------
BEGIN;

DROP TABLE IF EXISTS "Tax";
DROP TABLE IF EXISTS "TaxCategory";
DROP TABLE IF EXISTS "Company";
DROP TABLE IF EXISTS "User";

CREATE TABLE "User" ( 
	"id" SERIAL PRIMARY KEY,
	"email" VARCHAR( 300 ) NOT NULL,
	"password" VARCHAR( 300 ) NOT NULL,
	"name" VARCHAR( 45 ) NOT NULL,
	"createdAt" Bigint NOT NULL,
	"updatedAt" Bigint,
	"user" INT,
	"status" SmallInt
);

CREATE TABLE "Company" ( 
	"id" SERIAL PRIMARY KEY,
	"name" VARCHAR( 45 ) NOT NULL,
	"createdAt" Bigint NOT NULL,
	"updatedAt" Bigint,
	"user" INT REFERENCES "User",
	"status" SmallInt
);

CREATE TABLE "TaxCategory" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR(45) NOT NULL,
    "description" VARCHAR(300),
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT,
    "company" INT NOT NULL REFERENCES "Company",
    "user" INT REFERENCES "User",
    "status" SmallInt
);

CREATE TABLE "Tax" (
    "id" SERIAL PRIMARY KEY,
	"name" VARCHAR( 45 ) NOT NULL,
    "percentage" NUMERIC(3,2) NOT NULL,
    "description" VARCHAR(300),
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT,
    "category" INT NOT NULL REFERENCES "TaxCategory",
    "user" Int REFERENCES "User",
    "company" INT NOT NULL REFERENCES "Company",
    "status" SMALLINT NULL
);

COMMIT;
