import asyncio, threading, weakref, logging, time
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from py.behavior_engine import BehaviorSettings
from py.telegram_client import TelegramClient

class TelegramBotConfig(BaseModel):
    TelegramAgent: str
    memoryLimit: int
    separators: list[str]
    reasoningVisible: bool
    quickRestart: bool
    enableTTS: bool
    bot_token: str
    wakeWord: str
    behaviorSettings: Optional[BehaviorSettings] = None
    behaviorTargetChatIds: List[str] = Field(default_factory=list)

class TelegramBotManager:
    def __init__(self):
        self.bot_thread: Optional[threading.Thread] = None
        self.bot_client: Optional[TelegramClient] = None
        self.is_running = False
        self.config = None
        self.loop = None
        self._shutdown_event = threading.Event()
        self._startup_complete = threading.Event()
        self._ready_complete = threading.Event()
        self._startup_error: Optional[str] = None
        self._stop_requested = False

    def start_bot(self, config: TelegramBotConfig):
        if self.bot_thread and self.bot_thread.is_alive():
            raise Exception("Telegram 机器人正在停止中，请稍后")
        if self.is_running:
            raise Exception("Telegram 机器人已在运行")
        
        self.config = config
        self._shutdown_event.clear()
        self._startup_complete.clear()
        self._ready_complete.clear()
        self._startup_error = None
        self._stop_requested = False

        self.bot_thread = threading.Thread(
            target=self._run_bot_thread, args=(config,), daemon=True, name="TelegramBotThread"
        )
        self.bot_thread.start()

        if not self._startup_complete.wait(timeout=30):
            self.stop_bot()
            raise Exception("Telegram 机器人连接超时")
        if self._startup_error:
            self.stop_bot()
            raise Exception(f"Telegram 机器人启动失败: {self._startup_error}")
        if not self._ready_complete.wait(timeout=30):
            self.stop_bot()
            raise Exception("Telegram 机器人就绪超时")

    def _run_bot_thread(self, config: TelegramBotConfig):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

        async def main_startup():
            try:
                from py.get_setting import load_settings
                from py.behavior_engine import global_behavior_engine
                settings = await load_settings()
                
                # 同步行为配置
                behavior_data = settings.get("behaviorSettings", {})
                target_ids = config.behaviorTargetChatIds or settings.get("telegramBotConfig", {}).get("behaviorTargetChatIds", [])
                if behavior_data:
                    global_behavior_engine.update_config(behavior_data, {"telegram": target_ids})

                self.bot_client = TelegramClient()
                # 属性赋值
                for attr in ["TelegramAgent", "memoryLimit", "reasoningVisible", "quickRestart", "enableTTS", "wakeWord", "bot_token"]:
                    setattr(self.bot_client, attr, getattr(config, attr))
                self.bot_client.separators = config.separators or []
                self.bot_client.config = config
                self.bot_client._manager_ref = weakref.ref(self)

                if not global_behavior_engine.is_running:
                    asyncio.create_task(global_behavior_engine.start())

                self._startup_complete.set()
                await self.bot_client.run()
            except Exception as e:
                if not self._stop_requested:
                    self._startup_error = str(e)
                self._startup_complete.set()
                self._ready_complete.set()

        try:
            self.loop.run_until_complete(main_startup())
        finally:
            self._cleanup()
            
    def _cleanup(self):
        self.is_running = False
        if self.loop and not self.loop.is_closed():
            try:
                for task in asyncio.all_tasks(self.loop): task.cancel()
                self.loop.stop()
                self.loop.close()
            except: pass
        self.bot_client = None
        self.loop = None
        self._shutdown_event.set()

    def stop_bot(self):
        if not self.is_running and not self.bot_thread: return
        self._stop_requested = True
        self.is_running = False
        if self.bot_client:
            self.bot_client._shutdown_requested = True
            # 取消所有活跃任务
            for task in self.bot_client.active_tasks.values():
                task.cancel()
        if self.bot_thread and self.bot_thread.is_alive():
            self.bot_thread.join(timeout=10)
        self._stop_requested = False

    def get_status(self):
        return {
            "is_running": self.is_running,
            "startup_error": self._startup_error,
            "ready_completed": self._ready_complete.is_set()
        }
    
    def update_behavior_config(self, config: TelegramBotConfig):
        self.config = config
        if self.bot_client:
            for attr in ["TelegramAgent", "enableTTS", "wakeWord"]:
                setattr(self.bot_client, attr, getattr(config, attr))
        from py.behavior_engine import global_behavior_engine
        global_behavior_engine.update_config(config.behaviorSettings, {"telegram": config.behaviorTargetChatIds})