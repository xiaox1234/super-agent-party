import os
import re
import json
import asyncio
import shortuuid
from datetime import datetime
from py.get_setting import USER_DATA_DIR

# 存放所有日记本的目录（独立于系统配置文件，每个角色一个 JSON 文件）
DIARY_DIR = os.path.join(USER_DATA_DIR, 'diary')

# 兜底日记本（无角色 / 未启用角色卡时使用）
DEFAULT_BOOK_ID = 'default'

# 旧版单文件日记（用于一次性迁移到 default 日记本）
LEGACY_DIARY_FILE = os.path.join(DIARY_DIR, 'diary_data.json')

# 每个日记本最多保留的条目数量（防止文件无限膨胀）
MAX_ENTRIES = 500


def _safe_book_id(book_id) -> str:
    """把角色 id 规整成安全的文件名片段"""
    bid = str(book_id or '').strip()
    if not bid:
        return DEFAULT_BOOK_ID
    bid = re.sub(r'[^A-Za-z0-9_\-]', '_', bid)
    return bid or DEFAULT_BOOK_ID


def _book_file(book_id) -> str:
    return os.path.join(DIARY_DIR, f'{_safe_book_id(book_id)}.json')


def _empty_book(character_id=None, character_name=""):
    return {
        "characterId": character_id,
        "characterName": character_name or "",
        "entries": [],
    }


async def _migrate_legacy_if_needed():
    """把旧版 diary_data.json 迁移为 default 日记本（仅一次）"""
    default_file = _book_file(DEFAULT_BOOK_ID)
    if os.path.exists(default_file) or not os.path.exists(LEGACY_DIARY_FILE):
        return
    try:
        def _do():
            with open(LEGACY_DIARY_FILE, 'r', encoding='utf-8') as f:
                old = json.load(f)
            entries = old.get("entries", []) if isinstance(old, dict) else []
            book = _empty_book()
            book["entries"] = entries
            with open(default_file, 'w', encoding='utf-8') as f:
                json.dump(book, f, ensure_ascii=False, indent=4)
        await asyncio.to_thread(_do)
        print("📔 [日记系统] 已将旧版日记迁移到默认日记本")
    except Exception as e:
        print(f"[Diary] 迁移旧版日记失败: {e}")


async def load_diary_data(book_id: str = DEFAULT_BOOK_ID):
    """读取某个日记本，返回 {"characterId":..., "characterName":..., "entries":[...]}"""
    os.makedirs(DIARY_DIR, exist_ok=True)
    if _safe_book_id(book_id) == DEFAULT_BOOK_ID:
        await _migrate_legacy_if_needed()
    path = _book_file(book_id)
    if not os.path.exists(path):
        return _empty_book()
    try:
        def _read():
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        data = await asyncio.to_thread(_read)
        if not isinstance(data, dict):
            return _empty_book()
        if "entries" not in data or not isinstance(data["entries"], list):
            data["entries"] = []
        data.setdefault("characterId", None)
        data.setdefault("characterName", "")
        return data
    except Exception as e:
        print(f"[Diary] 读取日记本 {book_id} 失败: {e}")
        return _empty_book()


async def save_diary_data(data, book_id: str = DEFAULT_BOOK_ID):
    """全量保存某个日记本"""
    os.makedirs(DIARY_DIR, exist_ok=True)
    if not isinstance(data, dict):
        data = _empty_book()
    if "entries" not in data or not isinstance(data["entries"], list):
        data["entries"] = []
    data.setdefault("characterId", None)
    data.setdefault("characterName", "")
    # 截断，仅保留最近 MAX_ENTRIES 条
    data["entries"] = data["entries"][-MAX_ENTRIES:]
    path = _book_file(book_id)
    try:
        def _write():
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
        await asyncio.to_thread(_write)
    except Exception as e:
        print(f"[Diary] 保存日记本 {book_id} 失败: {e}")


async def append_diary_entry(entry_type: str, content: str, title: str = "", pushed_to=None,
                             book_id: str = DEFAULT_BOOK_ID, character_id=None, character_name=""):
    """向指定日记本追加一条日记，返回新条目"""
    if not content:
        return None
    data = await load_diary_data(book_id)
    # 同步本子的角色信息（角色可能改名）
    if character_id is not None:
        data["characterId"] = character_id
    if character_name:
        data["characterName"] = character_name
    entry = {
        "id": str(shortuuid.ShortUUID().random(length=10)),
        "time": datetime.now().isoformat(),
        "type": entry_type,
        "title": title or "",
        "content": content,
        "pushedTo": pushed_to or [],
    }
    data["entries"].append(entry)
    await save_diary_data(data, book_id)
    print(f"📔 [日记系统] 新增日记 [{book_id}/{entry_type}]: {(title or content)[:30]}")
    return entry


async def delete_diary_entry(entry_id: str, book_id: str = DEFAULT_BOOK_ID):
    """从指定日记本删除一条日记"""
    data = await load_diary_data(book_id)
    before = len(data["entries"])
    data["entries"] = [e for e in data["entries"] if e.get("id") != entry_id]
    if len(data["entries"]) != before:
        await save_diary_data(data, book_id)
        return True
    return False


async def list_diary_books():
    """列出所有日记本，自动：新建角色本 / 同名重联 / 清空无日记的孤儿本"""
    os.makedirs(DIARY_DIR, exist_ok=True)
    await _migrate_legacy_if_needed()

    # 1. 加载当前角色卡列表
    memories = []
    memory_by_name = {}
    try:
        from py.get_setting import load_settings
        settings = await load_settings()
        memories = (settings or {}).get("memories", []) or []
        for mem in memories:
            mn = (mem.get("name") or "").strip()
            if mn:
                memory_by_name[mn.lower()] = mem
    except Exception:
        pass

    memory_ids = {mem.get("id") for mem in memories if mem.get("id")}

    # 2. 扫描已有本子文件
    books = []
    existing_files = set()
    try:
        fnames = await asyncio.to_thread(lambda: os.listdir(DIARY_DIR))
    except Exception:
        fnames = []
    for fname in fnames:
        if not fname.endswith('.json'):
            continue
        if fname == os.path.basename(LEGACY_DIARY_FILE):
            continue
        book_id = fname[:-len('.json')]
        existing_files.add(fname)
        data = await load_diary_data(book_id)
        entries = data.get("entries", [])
        char_id = data.get("characterId")
        char_name = data.get("characterName", "")

        if char_id and char_id in memory_ids:
            # 角色仍存在 → 同步名称
            mem = next((m for m in memories if m.get("id") == char_id), None)
            if mem and data.get("characterName") != (mem.get("name") or ""):
                data["characterName"] = mem.get("name", "")
                await save_diary_data(data, book_id)
                char_name = data["characterName"]
        elif char_id:
            # 角色已删除
            if char_name and char_name.lower() in memory_by_name:
                # 同名角色重建 → 重联
                mem = memory_by_name[char_name.lower()]
                data["characterId"] = mem.get("id")
                data["characterName"] = mem.get("name", "")
                await save_diary_data(data, book_id)
                char_id = data["characterId"]
                char_name = data["characterName"]
            elif len(entries) == 0:
                # 无日记的孤儿本 → 删除文件并跳过
                try:
                    await asyncio.to_thread(lambda: os.remove(_book_file(book_id)))
                except Exception:
                    pass
                print(f"📔 [日记系统] 已清理孤儿日记本: {char_name or book_id}")
                continue
            # 有日记的孤儿本 → 保留

        last_time = ""
        if entries:
            try:
                last_time = max(e.get("time", "") for e in entries)
            except Exception:
                last_time = entries[-1].get("time", "")
        books.append({
            "bookId": book_id,
            "characterId": char_id,
            "characterName": char_name,
            "count": len(entries),
            "lastTime": last_time,
            "isDefault": book_id == DEFAULT_BOOK_ID,
        })

    # 3. 为还没有本子的角色自动创建空本
    for mem in memories:
        mid = mem.get("id")
        if not mid:
            continue
        fname = f'{_safe_book_id(mid)}.json'
        if fname not in existing_files:
            await save_diary_data(_empty_book(mid, mem.get("name", "")), mid)
            books.append({
                "bookId": mid,
                "characterId": mid,
                "characterName": mem.get("name", ""),
                "count": 0,
                "lastTime": "",
                "isDefault": False,
            })
            existing_files.add(fname)

    # 4. 确保默认兜底本
    if not any(b["bookId"] == DEFAULT_BOOK_ID for b in books):
        books.append({
            "bookId": DEFAULT_BOOK_ID,
            "characterId": None,
            "characterName": "",
            "count": 0,
            "lastTime": "",
            "isDefault": True,
        })

    # 5. 安全过滤：移除所有死标签（非默认 + 角色已删 + 无日记）
    books = [b for b in books if (
        b["isDefault"] or
        b["characterId"] in memory_ids or
        b["count"] > 0
    )]

    # 6. 排序：默认本 → 有日记的按最近更新倒序 → 空本按名字正序
    default_b = [b for b in books if b["isDefault"]]
    with_entries = sorted(
        [b for b in books if b["lastTime"] and not b["isDefault"]],
        key=lambda b: b["lastTime"], reverse=True,
    )
    empty_b = sorted(
        [b for b in books if not b["lastTime"] and not b["isDefault"]],
        key=lambda b: b.get("characterName", ""),
    )
    return default_b + with_entries + empty_b


async def query_diary_entries(query: str = "", book_id: str = DEFAULT_BOOK_ID,
                              start_time: str = "", end_time: str = "",
                              max_results: int = 5, entry_type: str = ""):
    """按时间范围和关键词搜索日记条目，返回匹配列表"""
    data = await load_diary_data(book_id)
    entries = data.get("entries", [])
    results = []
    query_lower = query.lower() if query else ""
    for e in reversed(entries):
        etime = e.get("time", "")
        if start_time and etime < start_time:
            continue
        if end_time and etime > end_time:
            continue
        if entry_type and e.get("type", "") != entry_type:
            continue
        if query_lower:
            title = (e.get("title", "") or "").lower()
            content = (e.get("content", "") or "").lower()
            if query_lower not in title and query_lower not in content:
                continue
        results.append(e)
        if max_results > 0 and len(results) >= max_results:
            break
    return results


async def get_recent_diary_entries(book_id: str = DEFAULT_BOOK_ID, n: int = 5):
    """获取最近 N 条日记条目"""
    data = await load_diary_data(book_id)
    entries = data.get("entries", [])
    return entries[-n:] if n > 0 else []
