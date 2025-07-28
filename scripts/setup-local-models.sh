#!/bin/bash

# MCP Token Saver - Local Model Setup Script
# Downloads and sets up Phi-3-mini and Gemma-2 models for local inference

set -e

MODELS_DIR="${HOME}/.mcp-tokens-saver/models"
PHI3_URL="https://huggingface.co/bartowski/Phi-3-mini-4k-instruct-v0.3-GGUF/resolve/main/phi-3-mini-4k-instruct.Q4_K_M.gguf"
GEMMA2_URL="https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it.Q4_K_M.gguf"

PHI3_FILENAME="phi-3-mini-4k-instruct.Q4_K_M.gguf"
GEMMA2_FILENAME="gemma-2-2b-it.Q4_K_M.gguf"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== MCP Token Saver - Local Model Setup ===${NC}"

# Check if llama.cpp is installed
if ! command -v llama-server &> /dev/null; then
    echo -e "${RED}Error: llama-server not found${NC}"
    echo "Please install llama.cpp first:"
    echo "  - Ubuntu/Debian: sudo apt install llama.cpp"
    echo "  - macOS: brew install llama.cpp"
    echo "  - From source: https://github.com/ggerganov/llama.cpp"
    exit 1
fi

# Check if wget or curl is available
if ! command -v wget &> /dev/null && ! command -v curl &> /dev/null; then
    echo -e "${RED}Error: wget or curl is required${NC}"
    exit 1
fi

# Create models directory
echo -e "${YELLOW}Creating models directory...${NC}"
mkdir -p "$MODELS_DIR"

# Function to download model
download_model() {
    local url=$1
    local filename=$2
    local filepath="${MODELS_DIR}/${filename}"
    
    if [ -f "$filepath" ]; then
        echo -e "${GREEN}✓ $filename already exists${NC}"
        return 0
    fi
    
    echo -e "${YELLOW}Downloading $filename...${NC}"
    
    if command -v wget &> /dev/null; then
        wget --progress=bar:force -O "$filepath" "$url"
    elif command -v curl &> /dev/null; then
        curl -L --progress-bar -o "$filepath" "$url"
    fi
    
    if [ -f "$filepath" ]; then
        echo -e "${GREEN}✓ $filename downloaded successfully${NC}"
        
        # Verify file size
        local size=$(stat -c%s "$filepath" 2>/dev/null || stat -f%z "$filepath" 2>/dev/null || echo "0")
        if [ "$size" -lt 1000000 ]; then
            echo -e "${RED}Error: Downloaded file seems too small ($size bytes)${NC}"
            rm -f "$filepath"
            return 1
        fi
    else
        echo -e "${RED}Error: Failed to download $filename${NC}"
        return 1
    fi
}

# Download models
echo -e "${YELLOW}Downloading models...${NC}"
download_model "$PHI3_URL" "$PHI3_FILENAME"
download_model "$GEMMA2_URL" "$GEMMA2_FILENAME"

# Check available RAM
echo -e "${YELLOW}Checking system resources...${NC}"
if command -v free &> /dev/null; then
    TOTAL_RAM=$(free -m | awk 'NR==2{print $2}')
elif command -v vm_stat &> /dev/null; then
    TOTAL_RAM=$(vm_stat | awk '/Pages free/ { free = $3 } /Pages active/ { active = $3 } /Pages inactive/ { inactive = $3 } /Pages wired/ { wired = $3 } END { print (free + active + inactive + wired) * 4096 / 1024 / 1024 }' | cut -d. -f1)
else
    TOTAL_RAM=8192
fi

echo -e "${GREEN}System RAM: ${TOTAL_RAM}MB${NC}"

# Recommend models based on RAM
echo -e "${YELLOW}Model recommendations:${NC}"
if [ "$TOTAL_RAM" -ge 6000 ]; then
    echo -e "${GREEN}✓ Phi-3-mini-4k-instruct (5.8GB RAM) - RECOMMENDED${NC}"
    echo -e "${GREEN}✓ Gemma-2-2B-IT (4GB RAM) - ALSO SUPPORTED${NC}"
elif [ "$TOTAL_RAM" -ge 4000 ]; then
    echo -e "${YELLOW}! Phi-3-mini-4k-instruct may be tight on RAM${NC}"
    echo -e "${GREEN}✓ Gemma-2-2B-IT (4GB RAM) - RECOMMENDED${NC}"
else
    echo -e "${RED}✗ Insufficient RAM for local models (need at least 4GB)${NC}"
    exit 1
fi

# Create systemd service files (optional)
create_systemd_service() {
    local model=$1
    local port=$2
    local filename=$3
    
    cat > "${HOME}/.config/systemd/user/mcp-local-${model}.service" << EOF
[Unit]
Description=MCP Token Saver - Local ${model} Model
After=network.target

[Service]
Type=simple
ExecStart=llama-server -m ${MODELS_DIR}/${filename} -c 4096 -ngl 99 --port ${port}
Restart=always
RestartSec=10
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

    echo -e "${GREEN}Created systemd service: mcp-local-${model}.service${NC}"
}

# Create launch scripts
create_launch_script() {
    local model=$1
    local port=$2
    local filename=$3
    
    cat > "${MODELS_DIR}/start-${model}.sh" << EOF
#!/bin/bash
echo "Starting ${model} model server..."
llama-server -m "${MODELS_DIR}/${filename}" -c 4096 -ngl 99 --port ${port}
EOF
    
    chmod +x "${MODELS_DIR}/start-${model}.sh"
    echo -e "${GREEN}Created launch script: ${MODELS_DIR}/start-${model}.sh${NC}"
}

# Create service files and scripts
echo -e "${YELLOW}Creating service files...${NC}"
create_launch_script "phi3" "8080" "$PHI3_FILENAME"
create_launch_script "gemma2" "8081" "$GEMMA2_FILENAME"

# Create systemd services if systemd is available
if command -v systemctl &> /dev/null; then
    mkdir -p "${HOME}/.config/systemd/user"
    create_systemd_service "phi3" "8080" "$PHI3_FILENAME"
    create_systemd_service "gemma2" "8081" "$GEMMA2_FILENAME"
    
    echo -e "${YELLOW}To enable systemd services:${NC}"
    echo "  systemctl --user daemon-reload"
    echo "  systemctl --user enable mcp-local-phi3.service"
    echo "  systemctl --user enable mcp-local-gemma2.service"
    echo "  systemctl --user start mcp-local-phi3.service"
    echo "  systemctl --user start mcp-local-gemma2.service"
fi

# Test model files
echo -e "${YELLOW}Verifying model files...${NC}"
for model in "$PHI3_FILENAME" "$GEMMA2_FILENAME"; do
    filepath="${MODELS_DIR}/${model}"
    if [ -f "$filepath" ]; then
        size=$(stat -c%s "$filepath" 2>/dev/null || stat -f%z "$filepath" 2>/dev/null)
        echo -e "${GREEN}✓ $model: $(numfmt --to=iec $size)${NC}"
    fi
done

# Summary
echo -e "\n${GREEN}=== Setup Complete ===${NC}"
echo -e "Models directory: ${MODELS_DIR}"
echo -e "Available models:"
echo -e "  - Phi-3-mini-4k-instruct: ${MODELS_DIR}/${PHI3_FILENAME}"
echo -e "  - Gemma-2-2B-IT: ${MODELS_DIR}/${GEMMA2_FILENAME}"
echo -e "\nTo start models:"
echo -e "  ${MODELS_DIR}/start-phi3.sh"
echo -e "  ${MODELS_DIR}/start-gemma2.sh"
echo -e "\nAPI endpoints:"
echo -e "  Phi-3-mini: http://localhost:8080/v1"
echo -e "  Gemma-2-2B: http://localhost:8081/v1"