"""Еженедельный перенос стихов из Telegram-канала на сайт.

Берёт посты с хэштегом #стихи, пропускает уже добавленные и дописывает
новые в window.__DATA__ внутри index.html: обычные стихи в раздел «архив»,
фиты (в посте упомянут другой автор) в раздел «фиты» с ссылкой на гостя.

Переменные окружения (секреты GitHub):
  TG_API_ID, TG_API_HASH  — с my.telegram.org
  TG_SESSION              — строка сессии, её печатает tools/tg_login.py
  TG_CHANNEL              — ссылка на канал (по умолчанию инвайт с сайта)
  TG_LIMIT                — сколько последних постов просматривать (по умолчанию 3000)
"""
import asyncio, json, os, re, sys
from datetime import timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
PRE = "<script>window.__DATA__="
TAG = "#стихи"
ME = "синус лев"
MSK = timezone(timedelta(hours=3))
FEAT_RE = re.compile(r"\b(feat\.?|ft\.?|фит|при участии)\b", re.I)


# ───────── работа с index.html ─────────
def load_site():
    html = INDEX.read_text(encoding="utf-8")
    lines = html.split("\n")
    i = next(n for n, l in enumerate(lines) if l.startswith(PRE))
    data, end = json.JSONDecoder().raw_decode(lines[i][len(PRE):])
    tail = lines[i][len(PRE) + end:]
    return html, lines, i, data, tail


def coauthors_block(html):
    m = re.search(r"const COAUTHORS = \{\n(.*?)\n\};", html, re.S)
    entries = {}
    for name, body in re.findall(r'^\s*"(.+?)":\s*\[(.*?)\],?\s*$', m.group(1), re.M):
        entries[name] = re.findall(r'url:\s*"https?://t\.me/([^"/?]+)', body)
    return m, entries


def norm(t):
    return re.sub(r"[^a-zа-яё0-9]+", "", t.lower().replace("ё", "е"))


# ───────── разбор поста ─────────
def clean_text(text):
    out = []
    for line in text.replace("\r", "").split("\n"):
        stripped = re.sub(r"#[\wа-яё_]+", "", line, flags=re.I).strip()
        if line.strip() and not stripped:
            continue  # строка из одних хэштегов
        out.append(re.sub(r"\s*#[\wа-яё_]+", "", line, flags=re.I).rstrip())
    while out and not out[0].strip(): out.pop(0)
    while out and not out[-1].strip(): out.pop()
    return "\n".join(out)


def is_title(line):
    letters = [c for c in line if c.isalpha()]
    return bool(letters) and len(line) <= 70 and not any(c.islower() for c in letters)


def strip_feat(s):
    s = re.sub(r"\s*[\(\[]?\s*(feat\.?|ft\.?|при участии|фит с)(\s|$).*$", "", s, flags=re.I)
    return re.sub(r"\s*@\w+", "", s).strip(" -–—()[]×x,&")


def is_credit_line(l):
    """Строка-подпись вида «фит с @user» или «feat. @user» — не часть стиха."""
    return bool(re.search(r"@\w+|t\.me/", l)) and not strip_feat(re.sub(r"\S*t\.me/\S*", "", l))


def mentions(msg):
    """@username и ссылки t.me/... из поста (кроме ссылок на сам канал)."""
    users, text = [], msg.message or ""
    from telethon.tl.types import MessageEntityMention, MessageEntityTextUrl, MessageEntityUrl, MessageEntityMentionName
    for ent, inner in (msg.get_entities_text() if msg.entities else []):
        u = None
        if isinstance(ent, MessageEntityMention):
            u = inner.lstrip("@")
        elif isinstance(ent, (MessageEntityTextUrl, MessageEntityUrl)):
            url = ent.url if isinstance(ent, MessageEntityTextUrl) else inner
            m = re.match(r"(?:https?://)?t(?:elegram)?\.me/([A-Za-z0-9_]{4,})/?$", url)
            u = m.group(1) if m else None
        elif isinstance(ent, MessageEntityMentionName):
            u = ("id", ent.user_id, inner)
        if u and u not in users:
            users.append(u)
    return users


def split_parts(body, guests):
    """Если в тексте есть строки-подписи с именем автора, делим по ним."""
    names = [ME] + guests
    keys = {norm(n): n for n in names}
    parts, who, buf = [], "", []
    for line in body.split("\n"):
        k = norm(line.rstrip(":"))
        if k and k in keys and len(line) < 60:
            if any(l.strip() for l in buf):
                parts.append({"who": who, "text": "\n".join(buf).strip("\n")})
            who, buf = keys[k], []
        else:
            buf.append(line)
    if any(l.strip() for l in buf):
        parts.append({"who": who, "text": "\n".join(buf).strip("\n")})
    return parts or [{"who": "", "text": body}]


async def resolve_guest(client, u, known):
    if isinstance(u, tuple):
        _, uid, label = u
        try:
            e = await client.get_entity(uid)
            uname = getattr(e, "username", None)
        except Exception:
            uname = None
        if uname:
            u = uname
        else:
            return label.lstrip("@"), None
    for name, unames in known.items():
        if u.lower() in (x.lower() for x in unames):
            return name, u
    try:
        e = await client.get_entity(u)
        name = getattr(e, "title", None) or " ".join(filter(None, [getattr(e, "first_name", None), getattr(e, "last_name", None)]))
    except Exception:
        name = None
    return (name or u), u


async def open_channel(client, link):
    from telethon.tl.functions.messages import CheckChatInviteRequest
    from telethon.tl.types import ChatInviteAlready, ChatInvitePeek
    m = re.search(r"t\.me/(?:\+|joinchat/)([\w-]+)", link)
    if m:
        r = await client(CheckChatInviteRequest(m.group(1)))
        if isinstance(r, (ChatInviteAlready, ChatInvitePeek)):
            return r.chat
        sys.exit("Аккаунт не состоит в канале по этой ссылке.")
    return await client.get_entity(int(link) if link.lstrip("-").isdigit() else link)


async def main():
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    html, lines, li, data, tail = load_site()
    cm, known = coauthors_block(html)
    poems, feats = data["poems"], data["feats"]
    seen_ids = {p.get("tg") for p in poems + feats if p.get("tg")}
    seen_text = set()
    for p in poems:
        seen_text.add(norm(p["text"])[:120])
    for f in feats:
        seen_text.add(norm("".join(pt["text"] for pt in f["parts"]))[:120])
        seen_text.update(norm(pt["text"])[:120] for pt in f["parts"])
    seen_text.discard("")

    client = TelegramClient(StringSession(os.environ["TG_SESSION"]), int(os.environ["TG_API_ID"]), os.environ["TG_API_HASH"])
    await client.start()
    chan = await open_channel(client, os.environ.get("TG_CHANNEL") or "https://t.me/+m6SKTVp1Z75hOGUy")
    limit = int(os.environ.get("TG_LIMIT") or 3000)

    found = []
    async for msg in client.iter_messages(chan, limit=limit):
        if msg.message and TAG in msg.message.lower():
            found.append(msg)
    found.reverse()  # от старых к новым

    pn = max(int(re.sub(r"\D", "", p["id"]) or 0) for p in poems)
    fn = max(int(re.sub(r"\D", "", f["id"]) or 0) for f in feats if re.fullmatch(r"f\d+", f["id"]))
    added, new_coauthors, report = [], {}, []

    for msg in found:
        if msg.id in seen_ids:
            continue
        body = clean_text(msg.message)
        if not body:
            continue
        raw_first = body.split("\n", 1)[0].strip()
        body = "\n".join(l for l in body.split("\n") if not is_credit_line(l)).strip("\n")
        first = body.split("\n", 1)[0].strip()
        if is_title(strip_feat(first)) and strip_feat(first):
            title, untitled = strip_feat(first), False
            body = body.split("\n", 1)[1].strip("\n") if "\n" in body else body
        else:
            title, untitled = first, True
        users = mentions(msg)
        guests = []
        for u in users:
            name, uname = await resolve_guest(client, u, {**known, **new_coauthors})
            if name == ME:
                continue
            guests.append(name)
            if uname and name not in known and name not in new_coauthors:
                new_coauthors[name] = [uname]
        if not guests and re.search(r"feat\.?|ft\.|при участии|фит с", raw_first, re.I):
            m = re.search(r"(?:feat\.?|ft\.|при участии|фит с)\s+(.+?)[\)\]]?$", raw_first, re.I)
            if m:
                guests = [m.group(1).strip()]
        key = norm(body)[:120]
        if key in seen_text:
            report.append(f"- пропущен дубль: {title} (пост {msg.id})")
            continue
        seen_text.add(key)
        date = msg.date.astimezone(MSK).strftime("%Y-%m-%d")
        link = f"https://t.me/c/{chan.id}/{msg.id}"
        if guests:
            fn += 1
            item = {"id": f"f{fn}", "title": title.upper() if untitled else title, "date": date, "coll": "",
                    "authors": guests, "parts": split_parts(body, guests), "src": "channel", "cats": [], "tg": msg.id}
            feats.append(item)
            report.append(f"- фит «{item['title']}» × {', '.join(guests)} — {date} ([пост]({link}))")
        else:
            pn += 1
            item = {"id": f"p{pn}", "title": title, "text": body, "date": date, "coll": "", "kind": "poem",
                    "src": "channel", "cats": [], "tg": msg.id}
            if untitled:
                item["untitled"] = True
            poems.append(item)
            report.append(f"- стих «{title}» — {date} ([пост]({link}))")
        added.append(item)

    await client.disconnect()

    if added:
        lines[li] = PRE + json.dumps(data, ensure_ascii=False) + tail
        html = "\n".join(lines)
        if new_coauthors:
            cm, _ = coauthors_block(html)
            extra = "".join(f',\n  "{n}": [{{ label: "Telegram", url: "https://t.me/{u[0]}" }}]' for n, u in new_coauthors.items())
            html = html[:cm.end(1)] + extra + html[cm.end(1):]
        INDEX.write_text(html, encoding="utf-8")

    summary = f"Постов с {TAG}: {len(found)}. Добавлено: {len(added)}.\n" + "\n".join(report)
    if new_coauthors:
        summary += "\n\nНовые соавторы: " + ", ".join(f"{n} (t.me/{u[0]})" for n, u in new_coauthors.items())
    print(summary)
    out = os.environ.get("GITHUB_STEP_SUMMARY")
    if out:
        Path(out).write_text(summary, encoding="utf-8")
    Path(os.environ.get("REPORT_FILE", "/tmp/tg_report.md")).write_text(summary, encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
