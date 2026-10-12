import { createClient } from "@libsql/client";
import { validateDbConfig, initDb, seedDemoData } from "../config/db.js";
import { validateWebhookConfig, resolveWebhookUrl } from "../config/webhookConfig.js";
import { Telegraf } from "telegraf";
import express from "express";
import http from "http";
import fs from "fs";
import path from "path";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passedCount++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failedCount++;
  }
}

async function runProductionSafetyTests() {
  console.log("🧪 Starting Production Safety Preparation Test Suite...\n");

  // ==========================================
  // PART 1: Database Production Config Validation
  // ==========================================
  console.log("--- PART 1: Turso Production Configuration Validation ---");

  // 1. Missing TURSO_DATABASE_URL in production
  try {
    validateDbConfig({
      NODE_ENV: "production",
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "valid-token",
    });
    assert(false, "Should have thrown for missing TURSO_DATABASE_URL");
  } catch (err: any) {
    assert(
      err.message.includes("TURSO_DATABASE_URL is required"),
      "Throws safe error when TURSO_DATABASE_URL is missing in production"
    );
  }

  // 2. Missing TURSO_AUTH_TOKEN in production
  try {
    validateDbConfig({
      NODE_ENV: "production",
      TURSO_DATABASE_URL: "libsql://prod-db.turso.io",
      TURSO_AUTH_TOKEN: "",
    });
    assert(false, "Should have thrown for missing TURSO_AUTH_TOKEN");
  } catch (err: any) {
    assert(
      err.message.includes("TURSO_AUTH_TOKEN is required"),
      "Throws safe error when TURSO_AUTH_TOKEN is missing in production"
    );
  }

  // 3. Prohibit local file fallback in production
  try {
    validateDbConfig({
      NODE_ENV: "production",
      TURSO_DATABASE_URL: "file:dev.db",
      TURSO_AUTH_TOKEN: "valid-token",
    });
    assert(false, "Should have thrown for file: URI in production");
  } catch (err: any) {
    assert(
      err.message.includes("cannot use a local file: URI"),
      "Throws error preventing file:dev.db fallback in production"
    );
  }

  // 4. Valid production credentials
  const validProdDb = validateDbConfig({
    NODE_ENV: "production",
    TURSO_DATABASE_URL: "libsql://campus-food-prod.turso.io",
    TURSO_AUTH_TOKEN: "jwt-token-12345",
  });
  assert(
    validProdDb.url === "libsql://campus-food-prod.turso.io" &&
      validProdDb.authToken === "jwt-token-12345" &&
      validProdDb.isProduction === true,
    "Valid production Turso credentials parsed correctly"
  );

  // 5. Development mode fallback
  const devDbConfig = validateDbConfig({
    NODE_ENV: "development",
  });
  assert(
    devDbConfig.url === "file:dev.db" &&
      devDbConfig.authToken === undefined &&
      devDbConfig.isProduction === false,
    "Development mode safely falls back to local file:dev.db"
  );

  // ==========================================
  // PART 2: Webhook Configuration & URL Resolution
  // ==========================================
  console.log("\n--- PART 2: Webhook URL Resolution & Validation ---");

  // 1. resolveWebhookUrl
  assert(
    resolveWebhookUrl("https://my-app.onrender.com") === "https://my-app.onrender.com/webhook",
    "resolveWebhookUrl appends /webhook to base URL"
  );
  assert(
    resolveWebhookUrl("https://my-app.onrender.com/") === "https://my-app.onrender.com/webhook",
    "resolveWebhookUrl strips trailing slash and appends /webhook"
  );
  assert(
    resolveWebhookUrl("https://my-app.onrender.com/webhook") === "https://my-app.onrender.com/webhook",
    "resolveWebhookUrl preserves existing /webhook path"
  );

  // 2. Missing WEBHOOK_URL in production
  try {
    validateWebhookConfig({
      NODE_ENV: "production",
      WEBHOOK_URL: "",
      TELEGRAM_WEBHOOK_SECRET: "secret_123",
    });
    assert(false, "Should have thrown for missing WEBHOOK_URL");
  } catch (err: any) {
    assert(
      err.message.includes("WEBHOOK_URL is required"),
      "Throws error when WEBHOOK_URL is missing in production"
    );
  }

  // 3. Non-HTTPS WEBHOOK_URL in production
  try {
    validateWebhookConfig({
      NODE_ENV: "production",
      WEBHOOK_URL: "http://insecure.onrender.com",
      TELEGRAM_WEBHOOK_SECRET: "secret_123",
    });
    assert(false, "Should have thrown for non-HTTPS WEBHOOK_URL");
  } catch (err: any) {
    assert(
      err.message.includes("must use HTTPS"),
      "Throws error when WEBHOOK_URL is not HTTPS"
    );
  }

  // 4. Missing TELEGRAM_WEBHOOK_SECRET in production
  try {
    validateWebhookConfig({
      NODE_ENV: "production",
      WEBHOOK_URL: "https://my-app.onrender.com",
      TELEGRAM_WEBHOOK_SECRET: "",
    });
    assert(false, "Should have thrown for missing TELEGRAM_WEBHOOK_SECRET");
  } catch (err: any) {
    assert(
      err.message.includes("TELEGRAM_WEBHOOK_SECRET is required"),
      "Throws error when TELEGRAM_WEBHOOK_SECRET is missing in production"
    );
  }

  // 5. Invalid secret token characters
  try {
    validateWebhookConfig({
      NODE_ENV: "production",
      WEBHOOK_URL: "https://my-app.onrender.com",
      TELEGRAM_WEBHOOK_SECRET: "invalid secret with spaces!",
    });
    assert(false, "Should have thrown for invalid characters in secret");
  } catch (err: any) {
    assert(
      err.message.includes("alphanumeric characters, underscores, or dashes"),
      "Throws error when secret contains illegal characters"
    );
  }

  // 6. Valid production webhook config
  const validWebhook = validateWebhookConfig({
    NODE_ENV: "production",
    WEBHOOK_URL: "https://my-bot.onrender.com",
    TELEGRAM_WEBHOOK_SECRET: "A_secure_webhook_secret-99",
  });
  assert(
    validWebhook.isProduction === true &&
      validWebhook.webhookUrl === "https://my-bot.onrender.com/webhook" &&
      validWebhook.secretToken === "A_secure_webhook_secret-99",
    "Valid production webhook configuration correctly resolved"
  );

  // ==========================================
  // PART 3: Telegraf Webhook Secret Token Enforcement
  // ==========================================
  console.log("\n--- PART 3: Telegraf Secret Token Verification ---");

  const testSecret = "Test_Secret_Token_4455";
  const dummyBot = new Telegraf("123456789:ABCdefGHIjklMNOpqrsTUVwxyz");
  let updateHandled = false;
  dummyBot.handleUpdate = async (update: any, res: any) => {
    updateHandled = true;
    res.writeHead(200).end("OK");
  };

  const testApp = express();
  testApp.use(express.json());
  testApp.use(
    dummyBot.webhookCallback("/webhook", {
      secretToken: testSecret,
    })
  );

  const server = http.createServer(testApp);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const serverAddress = server.address() as any;
  const testPort = serverAddress.port;

  async function sendMockWebhook(headers: Record<string, string>, body: any): Promise<{ statusCode: number; handled: boolean }> {
    updateHandled = false;
    const postData = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: testPort,
          path: "/webhook",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
            ...headers,
          },
        },
        (res) => {
          let resBody = "";
          res.on("data", (chunk) => (resBody += chunk));
          res.on("end", () => {
            resolve({ statusCode: res.statusCode || 0, handled: updateHandled });
          });
        }
      );
      req.on("error", reject);
      req.write(postData);
      req.end();
    });
  }

  try {
    // A: Request without secret header should NOT be handled
    const resNoHeader = await sendMockWebhook({}, { update_id: 1001 });
    assert(!resNoHeader.handled, "Incoming webhook without secret token header is rejected (not handled)");

    // B: Request with incorrect secret token header should NOT be handled
    const resWrongHeader = await sendMockWebhook(
      { "X-Telegram-Bot-Api-Secret-Token": "wrong_token_here" },
      { update_id: 1002 }
    );
    assert(!resWrongHeader.handled, "Incoming webhook with incorrect secret token header is rejected (not handled)");

    // C: Request with matching secret token header is processed and handled
    const resValidHeader = await sendMockWebhook(
      { "X-Telegram-Bot-Api-Secret-Token": testSecret },
      { update_id: 1003 }
    );
    assert(
      resValidHeader.handled && resValidHeader.statusCode === 200,
      "Incoming webhook with matching secret token is accepted and processed (200)"
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ==========================================
  // PART 4: Sample Data Isolation in Production
  // ==========================================
  console.log("\n--- PART 4: Sample Data Isolation in Production ---");

  const testDbFile = path.resolve("./test_prod_safety.db");
  if (fs.existsSync(testDbFile)) {
    fs.unlinkSync(testDbFile);
  }

  const testDb = createClient({ url: `file:${testDbFile}` });

  try {
    // Run initDb in PRODUCTION mode
    await initDb(testDb, { isProduction: true });

    // 1. Verify schema tables exist
    const restTableCheck = await testDb.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='restaurants'");
    assert(restTableCheck.rows.length === 1, "Schema tables created in production");

    // 2. Verify operational configurations exist
    const settingsCheck = await testDb.execute("SELECT value FROM special_order_settings WHERE key='min_delivery_fee'");
    assert(settingsCheck.rows[0]?.value === "50", "Operational special_order_settings preserved in production");

    const pricingCheck = await testDb.execute("SELECT COUNT(*) as count FROM delivery_pricing");
    assert(Number(pricingCheck.rows[0]?.count) === 7, "Operational campus delivery pricing defaults preserved (7 campuses)");

    // 3. Verify DEMO data was NOT seeded
    const restCount = await testDb.execute("SELECT COUNT(*) as count FROM restaurants");
    assert(Number(restCount.rows[0]?.count) === 0, "Production startup DOES NOT seed demo restaurants (0 demo restaurants)");

    const specRestCount = await testDb.execute("SELECT COUNT(*) as count FROM special_restaurants");
    assert(Number(specRestCount.rows[0]?.count) === 0, "Production startup DOES NOT seed demo special restaurants (0 demo special restaurants)");

    // 4. Verify seedDemoData works when called for development
    await seedDemoData(testDb);
    const devRestCount = await testDb.execute("SELECT COUNT(*) as count FROM restaurants");
    assert(Number(devRestCount.rows[0]?.count) > 0, "seedDemoData populates demo restaurants for local development when requested");
  } finally {
    testDb.close();
    if (fs.existsSync(testDbFile)) {
      fs.unlinkSync(testDbFile);
    }
  }

  console.log("\n========================================");
  console.log(`🏁 PRODUCTION SAFETY TESTS COMPLETED: ${passedCount} passed, ${failedCount} failed`);
  console.log("========================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runProductionSafetyTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
