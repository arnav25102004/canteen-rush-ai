-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

-- AlterTable (nullable first so we can backfill)
ALTER TABLE "announcements" ADD COLUMN "institution_id" TEXT;
ALTER TABLE "canteens"      ADD COLUMN "institution_id" TEXT;
ALTER TABLE "users"         ADD COLUMN "institution_id" TEXT;

-- CreateTable
CREATE TABLE "institutions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "email_domain" TEXT NOT NULL,
    "logo_url" TEXT,
    "city" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "institutions_slug_key" ON "institutions"("slug");

-- Seed default institution (Christ University BGR)
INSERT INTO "institutions" ("id", "name", "slug", "email_domain", "city", "is_active", "created_at", "updated_at")
VALUES (
  'inst_christ_bgr_01',
  'Christ University — Bannerghatta Road',
  'christ-bgr',
  'christuniversity.in',
  'Bengaluru',
  true,
  NOW(),
  NOW()
);

-- Backfill all existing canteens to the default institution
UPDATE "canteens" SET "institution_id" = 'inst_christ_bgr_01' WHERE "institution_id" IS NULL;

-- Backfill all existing users to the default institution
UPDATE "users" SET "institution_id" = 'inst_christ_bgr_01' WHERE "institution_id" IS NULL;

-- Now make canteens.institution_id NOT NULL
ALTER TABLE "canteens" ALTER COLUMN "institution_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "canteens_institution_id_idx" ON "canteens"("institution_id");
CREATE INDEX "users_institution_id_idx" ON "users"("institution_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "canteens" ADD CONSTRAINT "canteens_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "announcements" ADD CONSTRAINT "announcements_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
