"""market-data CLI。Windows タスクスケジューラから呼ぶ日次バッチ等。

使用例:
    uv run market-data update-events
    uv run market-data check-connection
    uv run market-data verify-range USDJPY
"""
import sys
from datetime import datetime, timedelta, timezone


def _print_err(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)


def cmd_update_events(db_path: str = "trading.db") -> None:
    """経済指標を MT5 から取得して DB に保存する(Phase 2c で本実装)。"""
    try:
        from market_data.events import update_events
        n = update_events()
        print(f"OK: {n} 件を保存しました。")
    except NotImplementedError:
        print("SKIP: update-events は Phase 2c で実装予定です。")


def cmd_check_connection() -> None:
    """MT5 への接続を確認する。"""
    try:
        import MetaTrader5 as mt5
        from market_data.providers.mt5 import MT5Provider
        p = MT5Provider()
        if p.initialize():
            info = mt5.terminal_info()
            account = mt5.account_info()
            print(f"OK: MT5 接続成功")
            if info:
                print(f"  broker    : {info.company}")
                print(f"  terminal  : {info.name} build {info.build}")
                print(f"  connected : {info.connected}")
                print(f"  path      : {info.path}")
            if account:
                print(f"  login     : {account.login} ({account.server})")
            else:
                print("  WARN: account_info() が None。MT5 でログイン済みか確認してください。")
            p.shutdown()
        else:
            err = mt5.last_error()
            _print_err(f"MT5 の初期化に失敗しました: {err}")
            _print_err("MT5 ターミナルが起動していてブローカーへログイン済みか確認してください。")
            sys.exit(1)
    except ImportError as e:
        _print_err(str(e))
        sys.exit(1)


def cmd_verify_range(symbol: str, db_path: str = "trading.db") -> None:
    """指定銘柄の M5 データが 5 年分取得できるか検証する(Phase 1 検証タスク)。"""
    try:
        from market_data.providers.mt5 import MT5Provider
        p = MT5Provider()
        if not p.initialize():
            _print_err("MT5 接続失敗")
            sys.exit(1)

        result = p.get_available_range(symbol)
        p.shutdown()

        if result is None:
            print(f"WARN: {symbol} の利用可能範囲を取得できませんでした。")
            return

        oldest, latest = result
        span = latest - oldest
        years = span.days / 365

        print(f"Symbol  : {symbol}")
        print(f"Oldest  : {oldest.strftime('%Y-%m-%d')}")
        print(f"Latest  : {latest.strftime('%Y-%m-%d')}")
        print(f"Span    : {span.days} days ({years:.1f} years)")

        if years >= 5:
            print("OK: 5年分以上のデータが利用可能です。")
        else:
            print(f"WARN: 5年分に足りません({years:.1f}年)。代替ソース(Dukascopy等)を検討してください。")

    except ImportError as e:
        _print_err(str(e))
        sys.exit(1)


def main() -> None:
    if len(sys.argv) < 2:
        print("使用方法: market-data <command> [args]")
        print("  update-events           経済指標を更新する")
        print("  check-connection        MT5 接続を確認する")
        print("  verify-range <SYMBOL>   銘柄のデータ取得可能期間を確認する")
        sys.exit(1)

    command = sys.argv[1]

    if command == "update-events":
        cmd_update_events()
    elif command == "check-connection":
        cmd_check_connection()
    elif command == "verify-range":
        if len(sys.argv) < 3:
            _print_err("verify-range には銘柄名が必要です。例: market-data verify-range USDJPY")
            sys.exit(1)
        cmd_verify_range(sys.argv[2])
    else:
        _print_err(f"不明なコマンド: {command}")
        sys.exit(1)
