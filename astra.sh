#!/usr/bin/env bash
# YF Astra — سكربت موحد لتشغيل كل المشاريع
# Usage: ./astra.sh <command> [project]
#   list              — عرض كل المشاريع
#   dev <project>     — تشغيل مشروع (vite/next/go)
#   build <project>   — بناء مشروع
#   hub               — تشغيل المنصة الموحدة
#   install <project> — تثبيت اعتماديات مشروع
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

projects=(
  "aaa-sniping-game:Silent Ridge:Vite"
  "aim-training-arena:Deadset Arena:Vite"
  "aim-training-arena-v2:Deadeye Arena:Vite"
  "asmr-pot-carving:Still Pottery:Vite"
  "cinematic-destruction-lab:Fracture Lab:Vite"
  "circuit-workbench:Circuit Lab:Vite"
  "commercial-space-designer:Forma Space:Vite"
  "constraint-cad:Datum CAD:Vite"
  "fpv-drone:Fieldwork FPV:Vite"
  "full-physics-engine:Newton Lab:Vite"
  "impossible-geometry-portals:Parallax:Vite"
  "infinite-zoom-storytelling:Folia:Vite"
  "multiplayer-racing:APEX Racing:Vite"
  "opencode-token-dashboard:OpenCode Insights:Vite"
  "optical-design-lab:Lumen Lab:Vite"
  "physics:Orbital:Vite"
  "plane-game:Aeronaut:Vite"
  "procedural-city-studio:Forma City:Vite"
  "spatial-knowledge-workspace:Margin:Vite"
  "ai-video-editor:Astra Video:Next"
  "web-design:Three Directions:Next"
  "web-design-5:Five Perspectives:Next"
  "excalidraw:Excalidraw:Yarn"
  "automator-go-migration:Automator:Go"
  "cli:Kanban:Go"
  "coding-client-from-scratch:Kiln:Node"
  "minecraft-single-html:Minecraft:HTML"
  "hub:YF Astra Hub:Next"
)

cmd="${1:-help}"
target="$2"

list() {
  echo -e "${CYAN}YF Astra — ${#projects[@]} مشروع${NC}"
  echo -e "${YELLOW}────────────────────────────────────────${NC}"
  printf "%-30s %-22s %s\n" "المجلد" "الاسم" "التقنية"
  echo "────────────────────────────────────────────────────────"
  for p in "${projects[@]}"; do
    IFS=: read -r dir name tech <<< "$p"
    printf "%-30s %-22s ${GREEN}%s${NC}\n" "$dir" "$name" "$tech"
  done
  echo ""
  echo -e "استخدم: ${YELLOW}./astra.sh dev <dir>${NC}  مثال: ./astra.sh dev aaa-sniping-game"
  echo -e "        ${YELLOW}./astra.sh hub${NC}             لتشغيل المنصة الموحدة"
}

run_dev() {
  if [ -z "$target" ]; then echo -e "${RED}حدد المشروع: ./astra.sh dev <dir>${NC}"; list; exit 1; fi
  if [ ! -d "$ROOT/$target" ]; then echo -e "${RED}المجلد غير موجود: $target${NC}"; exit 1; fi
  echo -e "${GREEN}→ تشغيل $target ...${NC}"
  cd "$ROOT/$target"
  if [ -f "package.json" ]; then
    if grep -q '"dev"' package.json; then npm run dev -- --host 0.0.0.0
    elif grep -q '"start"' package.json; then npm start
    else echo -e "${RED}لا يوجد سكربت dev/start${NC}"; exit 1; fi
  elif [ -f "go.mod" ]; then
    if [ -f "main.go" ]; then go run .
    elif [ -f "cmd/automator/main.go" ]; then go run ./cmd/automator
    else go run ./...
    fi
  elif [ -f "index.html" ]; then
    echo -e "${YELLOW}افتح index.html مباشرة في المتصفح${NC}"
    if command -v xdg-open >/dev/null; then xdg-open index.html
    elif command -v open >/dev/null; then open index.html
    else echo "افتح: $ROOT/$target/index.html"
    fi
  fi
}

run_build() {
  if [ -z "$target" ]; then echo -e "${RED}حدد المشروع${NC}"; exit 1; fi
  cd "$ROOT/$target"
  if [ -f "package.json" ]; then npm run build
  elif [ -f "go.mod" ]; then go build ./...
  else echo "لا يوجد بناء لهذا المشروع"
  fi
}

do_install() {
  if [ -z "$target" ]; then
    echo -e "${YELLOW}تثبيت كل مشاريع Node...${NC}"
    for p in "${projects[@]}"; do
      IFS=: read -r dir name tech <<< "$p"
      if [ -f "$ROOT/$dir/package.json" ]; then
        echo -e "${CYAN}→ $dir${NC}"
        (cd "$ROOT/$dir" && npm install --silent || true)
      fi
    done
  else
    cd "$ROOT/$target" && npm install
  fi
}

case "$cmd" in
  list|ls) list ;;
  dev|run) run_dev ;;
  build) run_build ;;
  hub) cd "$ROOT/hub" && npm run dev ;;
  install) do_install ;;
  help|*) 
    echo -e "${CYAN}YF Astra — سكربت التشغيل الموحد${NC}"
    echo ""
    echo "  ./astra.sh list              عرض كل المشاريع"
    echo "  ./astra.sh hub               تشغيل المنصة الموحدة (hub)"
    echo "  ./astra.sh dev <project>     تشغيل مشروع"
    echo "  ./astra.sh build <project>   بناء مشروع"
    echo "  ./astra.sh install [project] تثبيت الاعتماديات"
    echo ""
    list
    ;;
esac
