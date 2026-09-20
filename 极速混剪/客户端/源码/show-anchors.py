# -*- coding: utf-8 -*-
"""Print exact source snippets from the dumped base files, to build patch anchors."""

import pathlib

HERE = pathlib.Path(__file__).resolve().parent
TMP = HERE / "tmp"


def show(tag, text, needle, before, after):
    index = text.find(needle)
    if index < 0:
        print(tag, "NOT FOUND")
        return
    start = max(0, index - before)
    print(tag, "=", repr(text[start:index + len(needle) + after]))
    print()


def main():
    mix = (TMP / "mix.base.js").read_text(encoding="utf-8")
    acct = (TMP / "AccountPage.base.js").read_text(encoding="utf-8")
    show("Zvar", mix, "var Z={nickname:", 0, 240)
    show("dollar", mix, "function $(e=", 0, 190)
    show("zPersona", mix, "function z(e){let t=Q(e),n=[],r=", 0, 160)
    show("clearK", mix, "e.profile=Q({})", 70, 80)
    show("acctCount", acct, "function $(e)", 0, 100)
    index = acct.find("G=[{key:")
    end = acct.find("}],K=_(", index)
    print("Garr =", repr(acct[index:end + 3]))
    print()
    show("namePh", acct, "placeholder:`例如：红姐南京店`", 60, 60)
    show("promptPh", acct, "inputPlaceholder:`例如：红姐南京店`", 0, 40)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
