#!/usr/bin/env bash
# Instala el Arduinator en una Raspberry Pi 4 con Raspberry Pi OS (Bookworm).
# Uso: desde la carpeta arduinator/pi  →  sudo ./instalar.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo: sudo ./instalar.sh"; exit 1; }
ORIGEN="$(cd "$(dirname "$0")/.." && pwd)"

echo "▸ Dependencias del sistema"
apt-get update -qq
apt-get install -y -qq python3 python3-aiohttp python3-serial avahi-daemon rsync
read -r -p "¿Quieres que la Raspberry Pi también cante por sus parlantes? [s/N] " voz
if [[ "${voz,,}" == "s" ]]; then
  apt-get install -y -qq python3-numpy python3-scipy libportaudio2 python3-pip
  pip3 install --break-system-packages -q sounddevice
fi

echo "▸ Usuario y carpetas"
id arduinator >/dev/null 2>&1 || useradd --system --no-create-home --groups dialout,audio arduinator
mkdir -p /opt/arduinator /etc/arduinator /var/lib/arduinator
rsync -a --delete --exclude '.git' "$ORIGEN"/ /opt/arduinator/
[ -f /etc/arduinator/arduinator.toml ] || cp /opt/arduinator/pi/arduinator.ejemplo.toml /etc/arduinator/arduinator.toml
if [[ "${voz,,}" == "s" ]]; then sed -i 's/^activo = false/activo = true/' /etc/arduinator/arduinator.toml; fi
chown -R arduinator:arduinator /var/lib/arduinator

echo "▸ Nombre en la red: arduinator.local"
if [ "$(hostname)" != "arduinator" ]; then
  read -r -p "¿Cambiar el nombre de esta Raspberry Pi a «arduinator»? [S/n] " nom
  if [[ "${nom,,}" != "n" ]]; then hostnamectl set-hostname arduinator; sed -i "s/127.0.1.1.*/127.0.1.1\tarduinator/" /etc/hosts; fi
fi

echo "▸ Servicio"
cp /opt/arduinator/pi/arduinator.service /etc/systemd/system/arduinator.service
systemctl daemon-reload
systemctl enable --now arduinator
sleep 2
systemctl --no-pager --lines=5 status arduinator || true
IP=$(hostname -I | awk '{print $1}')
echo
echo "Listo. Desde cualquier PC de la red abre:  http://arduinator.local:8080  o  http://$IP:8080"
echo "Configuración: /etc/arduinator/arduinator.toml  ·  Registro: journalctl -u arduinator -f"
