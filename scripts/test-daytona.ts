/**
 * Quick test script to verify Daytona connection works.
 * Run with: npx tsx scripts/test-daytona.ts
 */

import { Daytona } from "@daytonaio/sdk";

async function main() {
  console.log("🔌 Connecting to Daytona...");
  const daytona = new Daytona();

  console.log("📦 Creating test volume...");
  const volume = await daytona.volume.get("test-dispatch", true);
  console.log(`   Volume: ${volume.id}`);

  console.log("🖥️  Creating test sandbox (debian:12-slim)...");
  const sandbox = await daytona.create({
    image: "debian:12-slim",
    volumes: [{ volumeId: volume.id, mountPath: "/home/daytona/data" }],
    resources: { cpu: 1, memory: 2, disk: 4 },
    autoStopInterval: 5, // Auto-stop after 5min
  });
  console.log(`   Sandbox: ${sandbox.id}`);

  console.log("⚡ Running command in sandbox...");
  const result = await sandbox.process.executeCommand("echo 'Hello from Daytona!' && uname -a");
  console.log(`   Output: ${result.result}`);

  console.log("📂 Testing file operations...");
  await sandbox.fs.uploadFiles([
    { source: Buffer.from("# Test\nHello from Dispatch V2"), destination: "/home/daytona/data/test.md" },
  ]);
  const content = await sandbox.fs.downloadFile("/home/daytona/data/test.md");
  console.log(`   File content: ${content}`);

  console.log("🛑 Stopping sandbox...");
  await sandbox.stop();

  console.log("\n✅ All tests passed! Daytona connection working.");
  console.log(`   Volume ID: ${volume.id}`);
  console.log(`   Sandbox ID: ${sandbox.id}`);
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
