import path from "node:path";
import { defineConfig } from "vitest/config";
import { generateKeyPairSync } from "node:crypto";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  const migrationsPath = path.join(__dirname, "migrations");
  const migrations = await readD1Migrations(migrationsPath);

  // Throwaway AfriZone identity key pair, made fresh per run and never
  // committed: the public half stands in for AfriZone's published key, the
  // private half lets test/afrizoneLogin.test.ts sign tokens like AfriZone does.
  const afrizoneKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Test-only overrides layered on top of wrangler.jsonc's bindings -
          // does not touch the real dev/production secrets (never committed).
          bindings: {
            TEST_MIGRATIONS: migrations,
            JWT_SECRET: "test-secret-for-automated-tests-only",
            NODE_ENV: "test",
            MART_INBOUND_SECRET: "local-dev-mart-inbound-secret",
            AFRIZONE_LOGIN_ENABLED: "true",
            AFRIZONE_IDENTITY_PUBLIC_KEY: afrizoneKeys.publicKey.export({ type: "spki", format: "pem" }) as string,
            TEST_AFRIZONE_PRIVATE_KEY: afrizoneKeys.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      // Test files each spin up their own Miniflare D1 emulation instance;
      // running them concurrently caused intermittent hangs/timeouts even
      // after fixing the leaked-PrismaClient issue below (reproduced
      // directly - disappeared once serialized). This suite is small (a few
      // dozen tests), so serial file execution costs a few seconds and buys
      // reliability.
      fileParallelism: false,
      // 5s is a unit-test default and these are integration tests: each file
      // boots its own Miniflare D1 and applies EVERY migration in setup before
      // its first test runs, so the first test in a file pays part of that
      // warm-up. That cost grows with the migration count - it has gone from 11
      // to 14 in a single session - and it began tipping individual tests over
      // 5s at random, which read as a flaky suite rather than as a clock
      // running out. Raising the ceiling removes the false signal without
      // hiding a real hang: 20s is still far below anything a genuinely stuck
      // test would take.
      testTimeout: 20_000,
    },
  };
});
