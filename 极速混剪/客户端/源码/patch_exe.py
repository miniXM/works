# -*- coding: utf-8 -*-
"""改写 Windows exe 的品牌信息：图标资源 + VERSIONINFO，走 Win32 资源 API。

用 BeginUpdateResource / UpdateResource / EndUpdateResource，由 Windows 自己重建
资源目录，所以名字改多长都行，也不会动 PE 的代码段。

用法：
    python patch_exe.py --show <exe>
    python patch_exe.py --exe <源 exe> --out <目标 exe> --ico <新图标.ico> \
        --company "公司名" --product "产品名" --description "产品名" \
        --copyright "Copyright © 2026 公司名"
"""

import argparse
import ctypes
import os
import pathlib
import shutil
import struct
import sys
from ctypes import wintypes

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import versioninfo  # noqa: E402

RT_ICON = 3
RT_GROUP_ICON = 14
RT_VERSION = 16
LOAD_LIBRARY_AS_DATAFILE = 0x00000002
LANG_DEFAULT = 1033

k32 = ctypes.WinDLL("kernel32", use_last_error=True)

k32.BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
k32.BeginUpdateResourceW.restype = wintypes.HANDLE
k32.UpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.LPVOID,
                                wintypes.WORD, wintypes.LPVOID, wintypes.DWORD]
k32.UpdateResourceW.restype = wintypes.BOOL
k32.EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
k32.EndUpdateResourceW.restype = wintypes.BOOL
k32.LoadLibraryExW.argtypes = [wintypes.LPCWSTR, wintypes.HANDLE, wintypes.DWORD]
k32.LoadLibraryExW.restype = wintypes.HMODULE
k32.FreeLibrary.argtypes = [wintypes.HMODULE]
k32.FreeLibrary.restype = wintypes.BOOL
k32.FindResourceW.argtypes = [wintypes.HMODULE, wintypes.LPVOID, wintypes.LPVOID]
k32.FindResourceW.restype = wintypes.HANDLE
k32.LoadResource.argtypes = [wintypes.HMODULE, wintypes.HANDLE]
k32.LoadResource.restype = wintypes.HANDLE
k32.LockResource.argtypes = [wintypes.HANDLE]
k32.LockResource.restype = wintypes.LPVOID
k32.SizeofResource.argtypes = [wintypes.HMODULE, wintypes.HANDLE]
k32.SizeofResource.restype = wintypes.DWORD

ENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMODULE, ctypes.c_void_p,
                              ctypes.c_void_p, ctypes.c_void_p)
ENUMPROCLANG = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMODULE, ctypes.c_void_p,
                                  ctypes.c_void_p, wintypes.WORD, ctypes.c_void_p)
k32.EnumResourceNamesW.argtypes = [wintypes.HMODULE, ctypes.c_void_p, ENUMPROC, ctypes.c_void_p]
k32.EnumResourceNamesW.restype = wintypes.BOOL
k32.EnumResourceLanguagesW.argtypes = [wintypes.HMODULE, ctypes.c_void_p, ctypes.c_void_p,
                                       ENUMPROCLANG, ctypes.c_void_p]
k32.EnumResourceLanguagesW.restype = wintypes.BOOL


def resource_id(raw):
    """资源名可能是整数 ID，也可能是字符串。"""
    if raw is None:
        return None
    value = ctypes.cast(raw, ctypes.c_void_p).value
    if value is not None and value <= 0xFFFF:
        return value
    return ctypes.cast(raw, ctypes.c_wchar_p).value


def list_resources(module, rtype):
    found = []

    def callback(_module, _type, name, _param):
        found.append(resource_id(name))
        return True

    if not k32.EnumResourceNamesW(module, rtype, ENUMPROC(callback), None):
        return []
    return found


def list_languages(module, rtype, name):
    found = []

    def callback(_module, _type, _name, lang, _param):
        found.append(lang)
        return True

    k32.EnumResourceLanguagesW(module, rtype, name, ENUMPROCLANG(callback), None)
    return found or [LANG_DEFAULT]


def read_resource(module, rtype, name):
    info = k32.FindResourceW(module, name, rtype)
    if not info:
        return b""
    handle = k32.LoadResource(module, info)
    pointer = k32.LockResource(handle)
    size = k32.SizeofResource(module, info)
    return ctypes.string_at(pointer, size)


# ------------------------------------------------------------------ 图标
def parse_ico(path):
    raw = pathlib.Path(path).read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", raw, 0)
    if reserved != 0 or kind != 1 or count == 0:
        raise RuntimeError("不是合法的 .ico：%s" % path)
    images = []
    for index in range(count):
        width, height, colors, _, planes, bits, size, offset = struct.unpack_from(
            "<BBBBHHII", raw, 6 + index * 16)
        images.append({"width": width or 256, "height": height or 256,
                       "planes": planes or 1, "bits": bits or 32,
                       "blob": raw[offset:offset + size]})
    return images


def build_icon_group(images, first_id):
    out = struct.pack("<HHH", 0, 1, len(images))
    for index, image in enumerate(images):
        out += struct.pack("<BBBBHHIH",
                           image["width"] if image["width"] < 256 else 0,
                           image["height"] if image["height"] < 256 else 0,
                           0, 0, image["planes"], image["bits"],
                           len(image["blob"]), first_id + index)
    return out


def apply_icon(handle, module, ico_path):
    images = parse_ico(ico_path)
    groups = list_resources(module, RT_GROUP_ICON) or [1]
    first_id = 1000
    for index, image in enumerate(images):
        blob = image["blob"]
        if not k32.UpdateResourceW(handle, RT_ICON, first_id + index, LANG_DEFAULT,
                                   blob, len(blob)):
            raise ctypes.WinError(ctypes.get_last_error())
    group_blob = build_icon_group(images, first_id)
    for group in groups:
        for lang in list_languages(module, RT_GROUP_ICON, group):
            if not k32.UpdateResourceW(handle, RT_GROUP_ICON, group, lang,
                                       group_blob, len(group_blob)):
                raise ctypes.WinError(ctypes.get_last_error())
    print("  图标：写入 %d 个尺寸，替换图标组 %s" %
          (len(images), ", ".join(str(g) for g in groups)))


# ------------------------------------------------------------------ 版本信息
def apply_version(handle, module, changes):
    blob = read_resource(module, RT_VERSION, 1)
    if not blob:
        print("  版本信息：exe 里没有 VERSIONINFO，跳过")
        return []
    root, _ = versioninfo.self_test(blob)      # 顺带做一次解析自检
    changed = []
    for node in versioninfo.walk_strings(root):
        wanted = changes.get(node["key"].lower())
        if not wanted:
            continue
        old = versioninfo.text_of(node)
        if old != wanted:
            versioninfo.set_text(node, wanted)
            changed.append("%s: %s → %s" % (node["key"], old, wanted))
    if not changed:
        print("  版本信息：没有需要改的字段")
        return []
    fresh = versioninfo.emit(root)
    for lang in list_languages(module, RT_VERSION, 1):
        if not k32.UpdateResourceW(handle, RT_VERSION, 1, lang, fresh, len(fresh)):
            raise ctypes.WinError(ctypes.get_last_error())
    print("  版本信息：")
    for line in changed:
        print("    " + line)
    return changed


def show_version(path):
    print(path)
    print("  大小：%s 字节" % format(pathlib.Path(path).stat().st_size, ","))
    module = k32.LoadLibraryExW(path, None, LOAD_LIBRARY_AS_DATAFILE)
    if not module:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        groups = list_resources(module, RT_GROUP_ICON)
        icons = list_resources(module, RT_ICON)
        print("  图标组：%s；图标图像：%d 个" %
              (", ".join(str(g) for g in groups) or "无", len(icons)))
        blob = read_resource(module, RT_VERSION, 1)
        if not blob:
            print("  （没有 VERSIONINFO）")
            return
        root, _ = versioninfo.self_test(blob)
        for node in versioninfo.walk_strings(root):
            print("  %-20s %s" % (node["key"], versioninfo.text_of(node)))
    finally:
        k32.FreeLibrary(module)


def main(argv=None):
    parser = argparse.ArgumentParser(description="改写 exe 的图标与版本信息")
    parser.add_argument("--exe")
    parser.add_argument("--out")
    parser.add_argument("--ico")
    parser.add_argument("--company")
    parser.add_argument("--product")
    parser.add_argument("--description")
    parser.add_argument("--copyright")
    parser.add_argument("--show")
    args = parser.parse_args(argv)

    if args.show:
        show_version(args.show)
        return 0
    if not args.exe:
        parser.error("要指定 --exe（或用 --show 查看）")

    source = os.path.abspath(args.exe)
    target = os.path.abspath(args.out) if args.out else source
    if target != source:
        shutil.copyfile(source, target)

    changes = {"companyname": args.company, "productname": args.product,
               "filedescription": args.description, "legalcopyright": args.copyright}
    print("改写 %s" % target)
    module = k32.LoadLibraryExW(target, None, LOAD_LIBRARY_AS_DATAFILE)
    if not module:
        raise ctypes.WinError(ctypes.get_last_error())
    handle = None
    try:
        handle = k32.BeginUpdateResourceW(target, False)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        if args.ico:
            apply_icon(handle, module, os.path.abspath(args.ico))
        apply_version(handle, module, changes)
        if not k32.EndUpdateResourceW(handle, False):
            handle = None
            raise ctypes.WinError(ctypes.get_last_error())
        handle = None
    finally:
        if handle:
            k32.EndUpdateResourceW(handle, True)
        k32.FreeLibrary(module)
    print("完成：%s（%s 字节）" % (target, format(pathlib.Path(target).stat().st_size, ",")))
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass
    sys.exit(main())
