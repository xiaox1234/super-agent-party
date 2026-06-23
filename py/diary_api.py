from fastapi import APIRouter, Body, HTTPException, Query
from typing import Dict, Any, Optional
from py.diary_system import (
    load_diary_data, save_diary_data, delete_diary_entry,
    list_diary_books, query_diary_entries, DEFAULT_BOOK_ID,
)

# 日记系统的数据路由
router = APIRouter(prefix="/api/diary", tags=["Diary System"])


@router.get("/books")
async def list_diary_books_api():
    """列出所有日记本（每个角色一本 + 默认兜底本）"""
    try:
        return {"books": await list_diary_books()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取日记本列表失败: {str(e)}")


@router.get("/get_data")
async def get_diary_data_api(book_id: str = Query(DEFAULT_BOOK_ID)):
    """获取某个日记本的全部条目，返回 {"characterId":..., "characterName":..., "entries":[...]}"""
    try:
        return await load_diary_data(book_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取日记数据失败: {str(e)}")


@router.post("/save_data")
async def save_diary_data_api(payload: Dict[str, Any] = Body(...)):
    """全量保存某个日记本，请求体: {"book_id": "xxx", "entries": [...]}（不传 book_id 则存默认本）"""
    try:
        book_id = payload.get("book_id", DEFAULT_BOOK_ID) or DEFAULT_BOOK_ID
        await save_diary_data(payload, book_id)
        return {"status": "success", "message": "日记数据保存成功"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存日记数据失败: {str(e)}")


@router.post("/delete")
async def delete_diary_entry_api(payload: Dict[str, Any] = Body(...)):
    """删除一条日记，请求体: {"id": "xxx", "book_id": "xxx"}"""
    entry_id = payload.get("id")
    if not entry_id:
        raise HTTPException(status_code=400, detail="缺少日记 id")
    book_id = payload.get("book_id", DEFAULT_BOOK_ID) or DEFAULT_BOOK_ID
    try:
        ok = await delete_diary_entry(entry_id, book_id)
        return {"status": "success" if ok else "not_found"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除日记失败: {str(e)}")


@router.get("/query")
async def query_diary_api(
    query: Optional[str] = Query(""),
    book_id: Optional[str] = Query(DEFAULT_BOOK_ID),
    start_time: Optional[str] = Query(""),
    end_time: Optional[str] = Query(""),
    max_results: Optional[int] = Query(5),
    entry_type: Optional[str] = Query(""),
):
    """按条件查询日记条目"""
    try:
        results = await query_diary_entries(
            query=query or "", book_id=book_id or DEFAULT_BOOK_ID,
            start_time=start_time or "", end_time=end_time or "",
            max_results=max_results, entry_type=entry_type or "",
        )
        return {"entries": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查询日记失败: {str(e)}")
