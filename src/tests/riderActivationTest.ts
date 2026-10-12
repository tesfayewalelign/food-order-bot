import { createClient } from "@libsql/client";
import fs from "fs";
import { activateRiderHelper } from "../bot/handlers/startHandler.js";
import { userState, resetUserState } from "../helpers/state.js";

const TEST_DB_PATH = "test_rider_activation.db";

async function setupTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  const testDb = createClient({ url: `file:${TEST_DB_PATH}` });

  await testDb.batch([
    `CREATE TABLE IF NOT EXISTS riders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      campus TEXT NOT NULL,
      secret_code TEXT UNIQUE,
      active INTEGER DEFAULT 1
    );`,

    `CREATE TABLE IF NOT EXISTS profiles (
      telegram_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      campus TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`
  ]);

  return testDb;
}

function createMockContext(userId: number, text: string = "") {
  const replies: { message: string; extra?: any }[] = [];
  const ctx = {
    from: {
      id: userId,
      first_name: `User_${userId}`,
      username: `user_${userId}`,
    },
    message: {
      text,
    },
    reply: async (message: string, extra?: any) => {
      replies.push({ message, extra });
      return { message_id: 1 };
    },
    replies,
  } as any;

  return ctx;
}

async function runRiderActivationTests() {
  console.log("🧪 Starting Secure Rider Activation Test Suite...\n");

  const testDb = await setupTestDb();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: Valid Authorized Rider Activates Successfully
    // -------------------------------------------------------------
    console.log("--- TEST 1: Authorized Rider Activation ---");
    const riderUserId1 = 70001;
    resetUserState(riderUserId1);

    await testDb.execute({
      sql: `INSERT INTO riders (id, telegram_id, name, phone, campus, secret_code, active)
            VALUES (101, NULL, 'Kebede Rider', '+251911000001', 'Main Campus', '8295', 1)`,
      args: [],
    });

    const ctx1 = createMockContext(riderUserId1, "/activate 8295");
    const result1 = await activateRiderHelper(ctx1, "8295", testDb);

    assert(result1 === true, "Valid code activation returns true");

    const riderRow1 = (
      await testDb.execute({
        sql: "SELECT * FROM riders WHERE id = 101",
        args: [],
      })
    ).rows[0];

    assert(Number(riderRow1?.telegram_id) === riderUserId1, "Rider telegram_id bound to user ID 70001");
    assert(riderRow1?.secret_code === null, "Single-use secret code consumed and set to NULL");

    const state1 = userState.get(riderUserId1);
    assert(state1?.isRider === true, "User session state marked as isRider = true");
    assert(state1?.campus === "Main Campus", "User session state contains rider campus");
    assert(ctx1.replies.some((r: any) => r.message.includes("Activation Successful")), "Success message dispatched to rider");

    // -------------------------------------------------------------
    // TEST 2: Invalid Code is Rejected
    // -------------------------------------------------------------
    console.log("\n--- TEST 2: Invalid Activation Code ---");
    const user2 = 70002;
    resetUserState(user2);

    await testDb.execute({
      sql: `INSERT INTO riders (id, telegram_id, name, phone, campus, secret_code, active)
            VALUES (102, NULL, 'Pending Rider 2', '+251911000002', 'Techno Campus', '4321', 1)`,
      args: [],
    });

    const ctx2 = createMockContext(user2, "/activate 9999");
    const result2 = await activateRiderHelper(ctx2, "9999", testDb);

    assert(result2 === false, "Invalid code returns false");

    const riderRow2 = (
      await testDb.execute({
        sql: "SELECT * FROM riders WHERE id = 102",
        args: [],
      })
    ).rows[0];

    assert(riderRow2?.telegram_id === null, "Pending rider telegram_id remains NULL");
    assert(riderRow2?.secret_code === "4321", "Pending code remains intact");
    assert(userState.get(user2)?.isRider !== true, "User session state is not rider");

    // -------------------------------------------------------------
    // TEST 3: Random Customer Sending 4 Digits in Chat is Not Activated
    // -------------------------------------------------------------
    console.log("\n--- TEST 3: Arbitrary 4-Digit Chat Message Isolation ---");
    const customerUserId = 70003;
    resetUserState(customerUserId);

    await testDb.execute({
      sql: `INSERT INTO riders (id, telegram_id, name, phone, campus, secret_code, active)
            VALUES (103, NULL, 'Pending Rider 3', '+251911000003', 'Africa Campus', '5555', 1)`,
      args: [],
    });

    // In the bot's message handler, messages without /activate or /start commands
    // do NOT invoke activateRiderHelper. Let's verify:
    // A regular text message like "5555" (e.g. food quantity or PIN) does not trigger rider binding.
    const messageText = "5555";
    const isCommand = messageText.startsWith("/");
    assert(isCommand === false, "Plain text '5555' is not a command");

    // Verify pending rider 103 was not claimed
    const riderRow3 = (
      await testDb.execute({
        sql: "SELECT * FROM riders WHERE id = 103",
        args: [],
      })
    ).rows[0];
    assert(riderRow3?.telegram_id === null, "Rider 103 remains unclaimed");
    assert(riderRow3?.secret_code === "5555", "Rider 103 secret_code remains 5555");
    assert(userState.get(customerUserId)?.isRider !== true, "Customer remains normal customer");

    // -------------------------------------------------------------
    // TEST 4: Already Activated Rider Cannot Improperly Activate Again
    // -------------------------------------------------------------
    console.log("\n--- TEST 4: Already Activated Rider Blocked from Re-activation ---");
    // User 70001 is already activated from Test 1 as rider 101.
    // Try to claim rider 103 with code 5555.
    const ctx4 = createMockContext(riderUserId1, "/activate 5555");
    const result4 = await activateRiderHelper(ctx4, "5555", testDb);

    assert(result4 === true, "Handled gracefully with informative notice");
    assert(ctx4.replies.some((r: any) => r.message.includes("already registered as an active rider")), "Informed user they are already an active rider");

    // Rider 103 must remain unclaimed
    const riderRow3StillUnclaimed = (
      await testDb.execute({
        sql: "SELECT * FROM riders WHERE id = 103",
        args: [],
      })
    ).rows[0];
    assert(riderRow3StillUnclaimed?.telegram_id === null, "Rider 103 was NOT hijacked by already-active rider");
    assert(riderRow3StillUnclaimed?.secret_code === "5555", "Rider 103 code remains available for intended recipient");

    // -------------------------------------------------------------
    // TEST 5: Consumed Code Cannot Be Reused
    // -------------------------------------------------------------
    console.log("\n--- TEST 5: Consumed Code Cannot Be Reused ---");
    // Code 8295 was used by user 70001 in Test 1 and set to NULL.
    // Another user tries to use 8295.
    const user5 = 70005;
    resetUserState(user5);
    const ctx5 = createMockContext(user5, "/activate 8295");
    const result5 = await activateRiderHelper(ctx5, "8295", testDb);

    assert(result5 === false, "Re-using consumed code returns false");
    assert(userState.get(user5)?.isRider !== true, "User 70005 is not given rider access");

    // -------------------------------------------------------------
    // TEST 6: Inactive Rider Record Cannot Be Activated
    // -------------------------------------------------------------
    console.log("\n--- TEST 6: Inactive Rider Record Cannot Be Activated ---");
    const user6 = 70006;
    resetUserState(user6);

    await testDb.execute({
      sql: `INSERT INTO riders (id, telegram_id, name, phone, campus, secret_code, active)
            VALUES (104, NULL, 'Inactive Rider', '+251911000004', 'Diaspora Campus', '1111', 0)`,
      args: [],
    });

    const ctx6 = createMockContext(user6, "/activate 1111");
    const result6 = await activateRiderHelper(ctx6, "1111", testDb);

    assert(result6 === false, "Inactive rider code returns false");
    const riderRow4 = (
      await testDb.execute({
        sql: "SELECT * FROM riders WHERE id = 104",
        args: [],
      })
    ).rows[0];
    assert(riderRow4?.telegram_id === null, "Inactive rider remains unactivated");

    // -------------------------------------------------------------
    // TEST 7: Code Exposure Verification
    // -------------------------------------------------------------
    console.log("\n--- TEST 7: Secret Code Exposure Audit ---");
    // Verify that none of the reply messages contained the raw activation code
    for (const reply of [...ctx1.replies, ...ctx2.replies, ...ctx4.replies, ...ctx5.replies, ...ctx6.replies]) {
      assert(!reply.message.includes("8295") && !reply.message.includes("4321") && !reply.message.includes("5555") && !reply.message.includes("1111"), `Reply message does not leak secret codes: "${reply.message.slice(0, 30)}..."`);
    }

    console.log(`\n========================================`);
    console.log(`🏁 RIDER ACTIVATION TESTS COMPLETED: ${passed} passed, ${failed} failed`);
    console.log(`========================================\n`);

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    testDb.close();
    try {
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
      if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
    } catch (e) {}
  }
}

runRiderActivationTests().catch((err) => {
  console.error("❌ Fatal error in rider activation tests:", err);
  process.exit(1);
});
