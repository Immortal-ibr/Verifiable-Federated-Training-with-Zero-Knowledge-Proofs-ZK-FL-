#!/bin/bash

# Setup script for ZK-Balance project
# Installs Circom, snarkjs, and compiles circuits

set -e

echo "=================================================="
echo "  ZK-Balance Setup"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check Node.js version
echo "Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js 18+ required (found: $(node -v))${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# Install npm dependencies
echo ""
echo "Installing npm dependencies..."
npm install
echo -e "${GREEN}✓${NC} Dependencies installed"

# Check if circom is installed
echo ""
echo "Checking for Circom..."
if ! command -v circom &> /dev/null; then
    echo -e "${YELLOW}⚠${NC}  Circom not found"
    echo ""
    echo "Please install Circom 2.x:"
    echo "  Option 1 (Homebrew on macOS):"
    echo "    brew install circom"
    echo ""
    echo "  Option 2 (From source):"
    echo "    git clone https://github.com/iden3/circom.git"
    echo "    cd circom"
    echo "    cargo build --release"
    echo "    cargo install --path circom"
    echo ""
    echo "Then re-run this script."
    exit 1
else
    CIRCOM_VERSION=$(circom --version | head -n 1)
    echo -e "${GREEN}✓${NC} $CIRCOM_VERSION"
fi

# Check if snarkjs is installed
echo ""
echo "Checking for snarkjs..."
if ! command -v snarkjs &> /dev/null; then
    echo -e "${YELLOW}Installing snarkjs globally...${NC}"
    npm install -g snarkjs
fi
SNARKJS_VERSION=$(snarkjs --version)
echo -e "${GREEN}✓${NC} snarkjs $SNARKJS_VERSION"

# Create directories
echo ""
echo "Creating directories..."
mkdir -p build/circuits
mkdir -p data
mkdir -p proofs
echo -e "${GREEN}✓${NC} Directories created"

# Compile circuits
echo ""
echo "Compiling Circom circuits..."
echo "  (This may take 30-60 seconds...)"

circom zk/circuits/balance.circom \
    --r1cs \
    --wasm \
    --sym \
    --c \
    -o build/circuits

echo -e "${GREEN}✓${NC} Circuit compiled"

# Get circuit info
echo ""
echo "Circuit information:"
snarkjs r1cs info build/circuits/balance.r1cs

# Generate proving key (using Groth16)
echo ""
echo "Generating proving key..."
echo "  Step 1: Powers of Tau ceremony..."

# Start a new powers of tau ceremony
snarkjs powersoftau new bn128 12 build/circuits/pot12_0000.ptau -v

# Contribute to the ceremony
snarkjs powersoftau contribute build/circuits/pot12_0000.ptau \
    build/circuits/pot12_0001.ptau \
    --name="First contribution" \
    -v \
    -e="random entropy"

# Prepare phase 2
snarkjs powersoftau prepare phase2 build/circuits/pot12_0001.ptau \
    build/circuits/pot12_final.ptau \
    -v

echo ""
echo "  Step 2: Generating zkey..."

# Generate initial zkey
snarkjs groth16 setup build/circuits/balance.r1cs \
    build/circuits/pot12_final.ptau \
    build/circuits/balance_0000.zkey

# Contribute to phase 2
snarkjs zkey contribute build/circuits/balance_0000.zkey \
    build/circuits/balance_0001.zkey \
    --name="1st Contributor" \
    -v \
    -e="more random entropy"

# Export final zkey
snarkjs zkey export verificationkey build/circuits/balance_0001.zkey \
    build/circuits/vkey.json

# Rename final zkey
mv build/circuits/balance_0001.zkey build/circuits/balance.zkey

echo -e "${GREEN}✓${NC} Proving key generated"

# Cleanup intermediate files
echo ""
echo "Cleaning up..."
rm -f build/circuits/pot12_*.ptau
rm -f build/circuits/balance_0000.zkey
echo -e "${GREEN}✓${NC} Cleanup complete"

# Summary
echo ""
echo "=================================================="
echo -e "  ${GREEN}✅ Setup Complete!${NC}"
echo "=================================================="
echo ""
echo "Generated files:"
echo "  • build/circuits/balance.wasm     - Circuit WASM"
echo "  • build/circuits/balance.r1cs     - Constraint system"
echo "  • build/circuits/balance.zkey     - Proving key"
echo "  • build/circuits/vkey.json        - Verification key"
echo ""
echo "Next steps:"
echo "  1. Generate sample data:"
echo "     npm run generate-data"
echo ""
echo "  2. Run the demo:"
echo "     npm run demo"
echo ""
echo "=================================================="
