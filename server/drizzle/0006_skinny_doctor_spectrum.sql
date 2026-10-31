CREATE TABLE `receipt_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`to_receipt_id` text NOT NULL,
	`from_customer_id` text NOT NULL,
	`to_customer_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`reason` text NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "receipt_moves_amount_paise_check" CHECK(typeof("receipt_moves"."amount_paise") = 'integer' and "receipt_moves"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `receipt_moves_receipt_id_idx` ON `receipt_moves` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `receipt_moves_from_customer_id_idx` ON `receipt_moves` (`from_customer_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_line_id` text NOT NULL,
	`order_id` text NOT NULL,
	`qty` integer NOT NULL,
	`reverses_delivery_id` text,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shipment_line_id`) REFERENCES `shipment_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "deliveries_qty_check" CHECK(typeof("__new_deliveries"."qty") = 'integer' and ("__new_deliveries"."qty" > 0 or ("__new_deliveries"."qty" < 0 and "__new_deliveries"."reverses_delivery_id" is not null)))
);
--> statement-breakpoint
INSERT INTO `__new_deliveries`("id", "shipment_line_id", "order_id", "qty", "action_id", "created_at") SELECT "id", "shipment_line_id", "order_id", "qty", "action_id", "created_at" FROM `deliveries`;--> statement-breakpoint
DROP TABLE `deliveries`;--> statement-breakpoint
ALTER TABLE `__new_deliveries` RENAME TO `deliveries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `deliveries_shipment_line_id_idx` ON `deliveries` (`shipment_line_id`);--> statement-breakpoint
CREATE INDEX `deliveries_order_id_idx` ON `deliveries` (`order_id`);--> statement-breakpoint
CREATE INDEX `deliveries_reverses_delivery_id_idx` ON `deliveries` (`reverses_delivery_id`);