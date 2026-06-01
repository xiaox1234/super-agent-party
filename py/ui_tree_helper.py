# py/ui_tree_helper.py
import platform
import asyncio
import json
import re
import os

# ==========================================
# 顶层环境变量注入：强制激活 Qt/GTK 的无障碍渲染
# ==========================================
os.environ["QT_ACCESSIBILITY"] = "1"
os.environ["GTK_A11Y"] = "1"

async def get_desktop_ui_tree(logical_width: int, logical_height: int, offset_x: int = 0, offset_y: int = 0) -> str:
    """
    异步跨平台获取当前前台窗口的精简 UI 树。
    所有节点的中心点坐标均会被转化为与截图视口完全对齐的 0-1000 千分比相对坐标。
    """
    system = platform.system()
    
    # 防止除以零的安全兜底
    logical_width = logical_width if logical_width > 0 else 1920
    logical_height = logical_height if logical_height > 0 else 1080
    
    try:
        if system == "Windows":
            return await asyncio.to_thread(_get_windows_ui_tree, logical_width, logical_height, offset_x, offset_y)
        elif system == "Darwin":
            return await asyncio.to_thread(_get_mac_ui_tree, logical_width, logical_height, offset_x, offset_y)
        elif system == "Linux":
            return await asyncio.to_thread(_get_linux_ui_tree, logical_width, logical_height, offset_x, offset_y)
        else:
            return "[]"
    except Exception as e:
        return f"[]"

def _normalize_coords(absolute_x: float, absolute_y: float, logical_width: int, logical_height: int, offset_x: int, offset_y: int):
    """
    将原生绝对像素坐标，通过剪裁偏移量和逻辑视口大小，安全地映射到 0-1000 相对坐标空间
    """
    logical_x = absolute_x - offset_x
    logical_y = absolute_y - offset_y
    
    grid_x = int((logical_x / logical_width) * 1000)
    grid_y = int((logical_y / logical_height) * 1000)
    
    grid_x = max(0, min(1000, grid_x))
    grid_y = max(0, min(1000, grid_y))
    return grid_x, grid_y


# ==========================================
# Windows 平台实现 (DPI 适配、Chromium唤醒、Java桥接自检)
# ==========================================
def _get_windows_ui_tree(logical_width: int, logical_height: int, offset_x: int, offset_y: int) -> str:
    try:
        import uiautomation as auto
        import ctypes
    except ImportError:
        return "[]"
    
    # 1. 解决 High-DPI 缩放坐标偏差 (使 UIA 物理坐标与 PyAutoGUI 截图完全对准)
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2) # PROCESS_PER_MONITOR_DPI_AWARE
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass

    foreground_window = auto.GetForegroundControl()
    if not foreground_window:
        return "[]"
        
    # 2. Windows 下的 Chromium/Electron 唤醒策略 (解决 Chrome、飞书、VS Code 休眠问题)
    try:
        # 主动定位前台窗口深处的 Document 节点并调取其属性，强制 Chromium 引擎触发 WM_GETOBJECT
        doc = foreground_window.DocumentControl(searchDepth=4)
        if doc.Exists(0.1):
            _ = doc.Name
            _ = doc.GetLegacyIAccessiblePattern()
    except Exception:
        pass
        
    elements = []
    max_elements = 60
    interactive_types = {
        "ButtonControl", "EditControl", "HyperlinkControl", "MenuItemControl", 
        "TabItemControl", "CheckBoxControl", "ComboBoxControl", "ListItemControl"
    }
    
    for control, depth in auto.WalkControl(foreground_window, includeTop=True):
        if len(elements) >= max_elements:
            break
            
        ctrl_type = control.ControlTypeName or ""
        name = control.Name or ""
        rect = control.BoundingRectangle
        is_interactive = ctrl_type in interactive_types
        
        if not rect or (not name and not is_interactive):
            continue
            
        width = rect.right - rect.left
        height = rect.bottom - rect.top
        if width <= 5 or height <= 5:
            continue
            
        abs_x = rect.left + width // 2
        abs_y = rect.top + height // 2
        grid_x, grid_y = _normalize_coords(abs_x, abs_y, logical_width, logical_height, offset_x, offset_y)
        
        clean_type = ctrl_type.replace("Control", "")
        elements.append({
            "type": clean_type,
            "name": name if name else "[Actionable]",
            "center": [grid_x, grid_y]
        })
        
    # 3. Java 架构自检模块 (当 IDE 或 Java 软件未开启 Access Bridge 时主动给出Warning)
    class_name = foreground_window.ClassName or ""
    if "SunAwt" in class_name and len(elements) == 0:
        elements.append({
            "type": "Warning",
            "name": "[Java Access Bridge (JAB) is disabled. Run 'jabswitch -enable' in Admin Cmd to wake up Java elements.]",
            "center": [500, 500]
        })
        
    return json.dumps(elements, ensure_ascii=False, indent=2)


# ==========================================
# macOS 平台实现 (包含对 Electron / Chromium / Java 唤醒机制)
# ==========================================
def _get_mac_ui_tree(logical_width: int, logical_height: int, offset_x: int, offset_y: int) -> str:
    try:
        import AppKit
        import ApplicationServices as AX
        import time
    except ImportError:
        return "[]"
        
    workspace = AppKit.NSWorkspace.sharedWorkspace()
    active_app = workspace.frontmostApplication()
    if not active_app:
        return "[]"
        
    pid = active_app.processIdentifier()
    app_element = AX.AXUIElementCreateApplication(pid)
    
    # macOS 下的 Chromium 强制唤醒魔法 (解决 macOS Chrome、飞书、VS Code、Slack 内部DOM空白)
    AX.AXUIElementSetAttributeValue(app_element, "AXEnhancedUserInterface", True)
    AX.AXUIElementSetAttributeValue(app_element, "AXManualAccessibility", True)
    
    # 必须给渲染线程 150 毫秒的时间初始化内部无障碍树，否则第一次获取依然会返回 []
    time.sleep(0.15)
    
    elements = []
    max_elements = 60
    interactive_roles = {"AXButton", "AXTextField", "AXLink", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXTextArea"}
    
    pos_re = re.compile(r"x:\s*([\d.-]+)\s+y:\s*([\d.-]+)")
    size_re = re.compile(r"w:\s*([\d.-]+)\s+h:\s*([\d.-]+)")

    def extract_bounds_safely(pos_obj, size_obj):
        x, y, w, h = None, None, None, None
        try:
            x, y = pos_obj.x, pos_obj.y
            w, h = size_obj.width, size_obj.height
        except Exception:
            pass
        if x is None:
            try:
                x, y = pos_obj[0], pos_obj[1]
                w, h = size_obj[0], size_obj[1]
            except Exception:
                pass
        if x is None:
            try:
                pos_str, size_str = str(pos_obj), str(size_obj)
                pos_match = pos_re.search(pos_str)
                size_match = size_re.search(size_str)
                if pos_match and size_match:
                    x, y = float(pos_match.group(1)), float(pos_match.group(2))
                    w, h = float(size_match.group(1)), float(size_match.group(2))
            except Exception:
                pass
        return x, y, w, h

    def walk(element, depth=0):
        if len(elements) >= max_elements:
            return
            
        err, role = AX.AXUIElementCopyAttributeValue(element, "AXRole", None)
        role_str = role if err == 0 else ""
        
        err, title = AX.AXUIElementCopyAttributeValue(element, "AXTitle", None)
        title_str = title if err == 0 and title else ""
        
        is_interactive = role_str in interactive_roles
        
        if not is_interactive and not title_str:
            err, children = AX.AXUIElementCopyAttributeValue(element, "AXChildren", None)
            if err == 0 and children:
                for child in children:
                    walk(child, depth + 1)
            return
            
        err, pos = AX.AXUIElementCopyAttributeValue(element, "AXPosition", None)
        err2, size = AX.AXUIElementCopyAttributeValue(element, "AXSize", None)
        
        if err == 0 and err2 == 0 and pos and size:
            x, y, w, h = extract_bounds_safely(pos, size)
            
            if x is not None and w > 5 and h > 5:
                abs_x = x + w / 2
                abs_y = y + h / 2
                grid_x, grid_y = _normalize_coords(abs_x, abs_y, logical_width, logical_height, offset_x, offset_y)
                
                elements.append({
                    "type": role_str.replace("AX", ""),
                    "name": title_str if title_str else "[Actionable]",
                    "center": [grid_x, grid_y]
                })
                
        err, children = AX.AXUIElementCopyAttributeValue(element, "AXChildren", None)
        if err == 0 and children:
            for child in children:
                walk(child, depth + 1)
                
    walk(app_element)
    
    # macOS 下 Java / JetBrains 窗口的无障碍缺失自检提示
    app_name = active_app.localizedName() or ""
    if ("java" in app_name.lower() or "idea" in app_name.lower() or "clion" in app_name.lower()) and len(elements) == 0:
        elements.append({
            "type": "Warning",
            "name": "[Java Accessibility might be disabled. Please check your JDK's accessibility.properties.]",
            "center": [500, 500]
        })
        
    return json.dumps(elements, ensure_ascii=False, indent=2)


# ==========================================
# Linux 平台实现 (基于 pyatspi / 环境变量注入)
# ==========================================
def _get_linux_ui_tree(logical_width: int, logical_height: int, offset_x: int, offset_y: int) -> str:
    try:
        import pyatspi
    except ImportError:
        return "[]"
        
    try:
        registry = pyatspi.Registry
        desktop = registry.getDesktop(0)
        elements = []
        max_elements = 50
        interactive_roles = {"push button", "entry", "link", "check box", "radio button", "combo box"}
        
        def walk(obj, depth=0):
            if len(elements) >= max_elements or not obj:
                return
                
            role = obj.getRoleName()
            name = obj.getName()
            is_interactive = role in interactive_roles
            
            if is_interactive or name:
                try:
                    comp = obj.getComponent()
                    if comp:
                        rect = comp.getExtents(pyatspi.XY_SCREEN)
                        x, y, w, h = rect.x, rect.y, rect.width, rect.height
                        if w > 5 and h > 5:
                            abs_x = x + w / 2
                            abs_y = y + h / 2
                            grid_x, grid_y = _normalize_coords(abs_x, abs_y, logical_width, logical_height, offset_x, offset_y)
                            
                            elements.append({
                                "type": role,
                                "name": name if name else "[Actionable]",
                                "center": [grid_x, grid_y]
                            })
                except Exception:
                    pass
            
            try:
                child_count = obj.getChildCount()
                for i in range(child_count):
                    walk(obj.getChildAtIndex(i), depth + 1)
            except Exception:
                pass
                
        for app in desktop:
            walk(app)
            if len(elements) > 0:
                break
                
        return json.dumps(elements, ensure_ascii=False, indent=2)
    except Exception:
        return "[]"