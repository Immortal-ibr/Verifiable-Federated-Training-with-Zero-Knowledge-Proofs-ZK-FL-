#!/usr/bin/env node
/**
 * Compile the secure aggregation circuit and run a Groth16 prove/verify roundtrip.
 * This exercises the real circuit, not the JS simulation.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

async function main() {
  const buildDir = path.join(__dirname, "build");
  if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

  const circomBin = path.join(__dirname, "..", "..", "..", "bin", "circom.exe");
  console.log("Compiling circuit with", circomBin);
  execSync(
    `"${circomBin}" ${path.join(
      __dirname,
      "secure_agg_client.circom"
    )} --r1cs --wasm --sym -o ${buildDir}`,
    { stdio: "inherit" }
  );

  console.log("Generating Powers of Tau...");
  execSync(
    `npx --yes snarkjs powersoftau new bn128 12 ${path.join(
      buildDir,
      "pot12_0000.ptau"
    )} -v`,
    { stdio: "inherit" }
  );
  execSync(
    `npx --yes snarkjs powersoftau contribute ${path.join(
      buildDir,
      "pot12_0000.ptau"
    )} ${path.join(buildDir, "pot12_0001.ptau")} -v -e="codex-test"`,
    { stdio: "inherit" }
  );

  console.log("Setting up Groth16...");
  execSync(
    `npx --yes snarkjs powersoftau prepare phase2 ${path.join(
      buildDir,
      "pot12_0001.ptau"
    )} ${path.join(buildDir, "pot12_final.ptau")}`,
    { stdio: "inherit" }
  );
  execSync(
    `npx --yes snarkjs groth16 setup ${path.join(
      buildDir,
      "secure_agg_client.r1cs"
    )} ${path.join(buildDir, "pot12_final.ptau")} ${path.join(
      buildDir,
      "secure_agg_client_0000.zkey"
    )}`,
    { stdio: "inherit" }
  );
  execSync(
    `npx --yes snarkjs zkey export verificationkey ${path.join(
      buildDir,
      "secure_agg_client_0000.zkey"
    )} ${path.join(buildDir, "vkey.json")}`,
    { stdio: "inherit" }
  );

  console.log("Building test input...");
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const DIM = 8;
  const clientId = 1n;
  const prfSeed = 1n;
  const tauSquared = 1n;

  const poseidonHash1 = (x) => F.toObject(poseidon([x]));
  const poseidonHash2 = (a, b) => F.toObject(poseidon([a, b]));
  const vectorHash = (values) => F.toObject(poseidon(values));

  const mask = [];
  for (let i = 0; i < DIM; i++) {
    mask.push(poseidonHash2(prfSeed, clientId * BigInt(DIM) + BigInt(i)));
  }
  const gradient = new Array(DIM).fill(0n);
  const maskedUpdate = mask.map((m, i) => m + gradient[i]);
  const sharedKeyHash = poseidonHash1(prfSeed);
  const rootG = vectorHash(gradient);

  const input = {
    client_id: clientId.toString(),
    shared_key_hash: sharedKeyHash.toString(),
    root_G: rootG.toString(),
    tau_squared: tauSquared.toString(),
    masked_update0: maskedUpdate[0].toString(),
    masked_update1: maskedUpdate[1].toString(),
    masked_update2: maskedUpdate[2].toString(),
    masked_update3: maskedUpdate[3].toString(),
    masked_update4: maskedUpdate[4].toString(),
    masked_update5: maskedUpdate[5].toString(),
    masked_update6: maskedUpdate[6].toString(),
    masked_update7: maskedUpdate[7].toString(),
    gradient: gradient.map((x) => x.toString()),
    mask: mask.map((x) => x.toString()),
    prf_seed: prfSeed.toString(),
  };
  fs.writeFileSync(path.join(buildDir, "input.json"), JSON.stringify(input));

  console.log("Generating witness...");
  execSync(
    `npx --yes snarkjs wtns calculate ${path.join(
      buildDir,
      "secure_agg_client_js",
      "secure_agg_client.wasm"
    )} ${path.join(buildDir, "input.json")} ${path.join(
      buildDir,
      "witness.wtns"
    )}`,
    { stdio: "inherit" }
  );

  console.log("Proving...");
  execSync(
    `npx --yes snarkjs groth16 prove ${path.join(
      buildDir,
      "secure_agg_client_0000.zkey"
    )} ${path.join(buildDir, "witness.wtns")} ${path.join(
      buildDir,
      "proof.json"
    )} ${path.join(buildDir, "public.json")}`,
    { stdio: "inherit" }
  );

  console.log("Verifying...");
  execSync(
    `npx --yes snarkjs groth16 verify ${path.join(
      buildDir,
      "vkey.json"
    )} ${path.join(buildDir, "public.json")} ${path.join(
      buildDir,
      "proof.json"
    )}`,
    { stdio: "inherit" }
  );

  console.log("✅ Secure aggregation circuit compiled and verified");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
