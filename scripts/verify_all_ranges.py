"""Phase 1 出口条件: 主要 8 ペアの M5 データが 5 年分取得可能か一括検証する。

1 度だけ MT5 を初期化し、symbol_select で Market Watch に載せてから判定する。
"""
import sys
from datetime import datetime, timezone

import MetaTrader5 as mt5

SYMBOLS = ['USDJPY', 'EURUSD', 'GBPUSD', 'AUDUSD', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURGBP']


def resolve_symbol(name: str) -> str | None:
    info = mt5.symbol_info(name)
    if info is not None:
        return name
    all_syms = mt5.symbols_get()
    if all_syms:
        for s in all_syms:
            if s.name.startswith(name):
                return s.name
    return None


def check(name: str) -> str:
    resolved = resolve_symbol(name)
    if resolved is None:
        return f"NOTFOUND    | {name}: ブローカーに銘柄が存在しません"

    if not mt5.symbol_select(resolved, True):
        return f"SELECT_FAIL | {name} -> {resolved}: symbol_select に失敗"

    rates = mt5.copy_rates_from_pos(resolved, mt5.TIMEFRAME_M5, 0, 2_000_000)
    if rates is None or len(rates) == 0:
        err = mt5.last_error()
        return f"NO_DATA     | {name} -> {resolved}: copy_rates 空 (last_error={err})"

    from_ts = datetime.fromtimestamp(int(rates[0]['time']), tz=timezone.utc)
    to_ts = datetime.fromtimestamp(int(rates[-1]['time']), tz=timezone.utc)
    years = (to_ts - from_ts).days / 365
    status = "OK" if years >= 5 else "SHORT"
    return f"{status:<11} | {name} -> {resolved}: {from_ts:%Y-%m-%d} .. {to_ts:%Y-%m-%d} ({years:.1f}y, {len(rates)} bars)"


def main() -> int:
    if not mt5.initialize():
        print(f"ERROR: mt5.initialize failed: {mt5.last_error()}", file=sys.stderr)
        return 1

    info = mt5.terminal_info()
    account = mt5.account_info()
    print(f"broker: {info.company if info else '?'}, login: {account.login if account else '?'}")
    print()

    results = [check(s) for s in SYMBOLS]
    mt5.shutdown()

    for line in results:
        print(line)

    short = [l for l in results if not l.startswith("OK")]
    print()
    if short:
        print(f"WARN: {len(short)} 銘柄が 5 年分未満または取得不可です。Dukascopy 等の代替ソース検討。")
        return 2
    print("OK: 全 8 ペア 5 年分以上のデータが利用可能です。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
