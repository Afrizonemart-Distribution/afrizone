-- Tiers an admin can add to (Settings > Tiers), and the countries Part Time
-- works in: Nigeria live, the rest of Africa listed as coming soon. Tasks and
-- Partimers get a country and a state. Additive only.

CREATE TABLE "Tier" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "docLabel" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "Tier" ("key", "label", "description", "docLabel", "sortOrder") VALUES
  ('STUDENT', 'Student', 'Campus tasks, surveys, promo.', 'Matric number / student ID', 1),
  ('DISPATCH', 'Dispatch', 'Parcel runs & delivery.', 'Driver''s licence + vehicle papers', 2),
  ('REMOTE', 'Remote', 'Online data, support, freelance.', 'Portfolio / CV (optional)', 3),
  ('PROMO', 'Promo', 'Activations & field marketing.', 'Reference / past activation', 4),
  ('TRADE', 'Trade', 'Skilled trades.', 'Trade certification', 5);

CREATE TABLE "Country" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "live" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 1
);
INSERT INTO "Country" ("code", "name", "live", "sortOrder") VALUES
  ('NG', 'Nigeria', true, 0),
  ('DZ', 'Algeria', false, 1),
  ('AO', 'Angola', false, 1),
  ('BJ', 'Benin', false, 1),
  ('BW', 'Botswana', false, 1),
  ('BF', 'Burkina Faso', false, 1),
  ('BI', 'Burundi', false, 1),
  ('CV', 'Cabo Verde', false, 1),
  ('CM', 'Cameroon', false, 1),
  ('CF', 'Central African Republic', false, 1),
  ('TD', 'Chad', false, 1),
  ('KM', 'Comoros', false, 1),
  ('CG', 'Congo', false, 1),
  ('CD', 'DR Congo', false, 1),
  ('CI', 'Côte d''Ivoire', false, 1),
  ('DJ', 'Djibouti', false, 1),
  ('EG', 'Egypt', false, 1),
  ('GQ', 'Equatorial Guinea', false, 1),
  ('ER', 'Eritrea', false, 1),
  ('SZ', 'Eswatini', false, 1),
  ('ET', 'Ethiopia', false, 1),
  ('GA', 'Gabon', false, 1),
  ('GM', 'Gambia', false, 1),
  ('GH', 'Ghana', false, 1),
  ('GN', 'Guinea', false, 1),
  ('GW', 'Guinea-Bissau', false, 1),
  ('KE', 'Kenya', false, 1),
  ('LS', 'Lesotho', false, 1),
  ('LR', 'Liberia', false, 1),
  ('LY', 'Libya', false, 1),
  ('MG', 'Madagascar', false, 1),
  ('MW', 'Malawi', false, 1),
  ('ML', 'Mali', false, 1),
  ('MR', 'Mauritania', false, 1),
  ('MU', 'Mauritius', false, 1),
  ('MA', 'Morocco', false, 1),
  ('MZ', 'Mozambique', false, 1),
  ('NA', 'Namibia', false, 1),
  ('NE', 'Niger', false, 1),
  ('RW', 'Rwanda', false, 1),
  ('ST', 'São Tomé and Príncipe', false, 1),
  ('SN', 'Senegal', false, 1),
  ('SC', 'Seychelles', false, 1),
  ('SL', 'Sierra Leone', false, 1),
  ('SO', 'Somalia', false, 1),
  ('ZA', 'South Africa', false, 1),
  ('SS', 'South Sudan', false, 1),
  ('SD', 'Sudan', false, 1),
  ('TZ', 'Tanzania', false, 1),
  ('TG', 'Togo', false, 1),
  ('TN', 'Tunisia', false, 1),
  ('UG', 'Uganda', false, 1),
  ('ZM', 'Zambia', false, 1),
  ('ZW', 'Zimbabwe', false, 1);

ALTER TABLE "Task" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'NG';
ALTER TABLE "Task" ADD COLUMN "state" TEXT;
ALTER TABLE "User" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'NG';
ALTER TABLE "User" ADD COLUMN "state" TEXT;
