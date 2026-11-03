"""Запустить ОДИН раз у себя на компьютере, чтобы получить TG_SESSION.

  pip install telethon
  python tools/tg_login.py

Скрипт спросит api_id и api_hash (my.telegram.org → API development tools),
номер телефона и код из Telegram, затем напечатает длинную строку.
Эту строку положите в секрет TG_SESSION репозитория. Никому её не показывайте:
это вход в ваш аккаунт. Отозвать: Telegram → Настройки → Устройства.
"""
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

api_id = int(input("api_id: ").strip())
api_hash = input("api_hash: ").strip()
with TelegramClient(StringSession(), api_id, api_hash) as client:
    print("\nTG_SESSION (скопируйте целиком):\n")
    print(client.session.save())
