import json
from py.diary_system import query_diary_entries, list_diary_books, DEFAULT_BOOK_ID

diary_query_tool = {
    "type": "function",
    "function": {
        "name": "query_diary",
        "description": (
            "查询日记记录，让AI回忆特定时间发生的事情。"
            "可按时间范围、关键词、类型过滤，返回匹配的日记条目。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索关键词或描述，用于匹配日记标题和内容。留空则只按时间过滤。"
                },
                "book_id": {
                    "type": "string",
                    "description": "要查询的日记本ID（角色ID）。留空则查询当前角色的日记本。"
                },
                "start_time": {
                    "type": "string",
                    "description": "起始时间，ISO格式如 2024-01-01T00:00:00。不填则不限制起始时间。"
                },
                "end_time": {
                    "type": "string",
                    "description": "结束时间，ISO格式如 2024-12-31T23:59:59。不填则不限制结束时间。"
                },
                "max_results": {
                    "type": "integer",
                    "description": "最多返回几条结果，默认5。",
                    "default": 5
                },
                "entry_type": {
                    "type": "string",
                    "description": "日记类型过滤：think（思考）、webSearch（联网搜索）、knowledge（知识库）、imMessage（主动消息）、browserControl（浏览器控制）、smartHome（智能家居）、chatSummary（聊天总结）。留空则不过滤类型。"
                }
            }
        }
    }
}

diary_books_tool = {
    "type": "function",
    "function": {
        "name": "list_diary_books",
        "description": "列出所有可用的日记本（每个角色一本 + 默认兜底本）。",
        "parameters": {
            "type": "object",
            "properties": {}
        }
    }
}


async def handle_query_diary(query: str = "", book_id: str = DEFAULT_BOOK_ID,
                             start_time: str = "", end_time: str = "",
                             max_results: int = 5, entry_type: str = ""):
    try:
        results = await query_diary_entries(
            query=query or "", book_id=book_id or DEFAULT_BOOK_ID,
            start_time=start_time or "", end_time=end_time or "",
            max_results=max_results, entry_type=entry_type or "",
        )
        if not results:
            return "没有找到匹配的日记记录。"
        out = []
        for e in results:
            t = e.get("title", "") or e.get("content", "")[:24]
            out.append({
                "id": e.get("id", ""),
                "time": e.get("time", ""),
                "type": e.get("type", ""),
                "title": e.get("title", ""),
                "content": e.get("content", ""),
            })
        return json.dumps(out, ensure_ascii=False, indent=2)
    except Exception as ex:
        return f"查询日记时出错: {str(ex)}"


async def handle_list_diary_books():
    try:
        books = await list_diary_books()
        return json.dumps(books, ensure_ascii=False, indent=2)
    except Exception as ex:
        return f"列出日记本时出错: {str(ex)}"
