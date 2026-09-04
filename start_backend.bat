@echo off
cd /d "%~dp0backend"
if not exist .venv (
  echo Creating virtual environment...
  python -m venv .venv
  .venv\Scripts\python.exe -m pip install -q -r requirements.txt
)
echo Starting PA Task Audit backend + frontend on http://localhost:8000
.venv\Scripts\python.exe run.py
