"""market-data CLI。Windows タスクスケジューラから呼ぶ日次バッチ等。

使用例:
    uv run market-data update-events --csv-path path/to/economic_calendar.csv
    uv run market-data check-connection
    uv run market-data verify-range USDJPY
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _print_err(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)


def _resolve_csv_path(cli_path: str | None) -> Path | None:
    """CSV パスを決定する(引数 > 環境変数 > MT5 既定パス推測)。"""
    if cli_path:
        return Path(cli_path)
    env = os.environ.get("ECONOMIC_CALENDAR_CSV")
    if env:
        return Path(env)
    # MT5 既定パス(推測): %APPDATA%/MetaQuotes/Terminal/<instance-id>/MQL5/Files/economic_calendar.csv
    # instance-id は動的なのでヒントのみ返す
    return None


def cmd_update_events(cli_path: str | None = None) -> None:
    """CSV(MQL5 EconomicCalendarExport.mq5 の出力)を取り込んで economic_events に upsert する。"""
    from market_data.events import update_events

    csv_path = _resolve_csv_path(cli_path)
    if csv_path is None:
        _print_err(
            "CSV パスが指定されていません。--csv-path で指定するか、"
            "環境変数 ECONOMIC_CALENDAR_CSV を設定してください。"
        )
        _print_err(
            "MT5 の書き出し先は通常 "
            "%APPDATA%/MetaQuotes/Terminal/<instance-id>/MQL5/Files/economic_calendar.csv です。"
        )
        sys.exit(1)

    try:
        n = update_events(csv_path)
        print(f"OK: {n} 件を upsert しました({csv_path})。")
    except FileNotFoundError as e:
        _print_err(str(e))
        sys.exit(1)


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


def _extract_flag(args: list[str], name: str) -> str | None:
    """`--name value` または `--name=value` を args から抽出して消費する。"""
    for i, a in enumerate(args):
        if a == name:
            if i + 1 < len(args):
                value = args[i + 1]
                del args[i:i + 2]
                return value
            return None
        if a.startswith(f"{name}="):
            value = a.split("=", 1)[1]
            del args[i]
            return value
    return None


def main() -> None:
    if len(sys.argv) < 2:
        print("使用方法: market-data <command> [args]")
        print("  update-events [--csv-path PATH]  経済指標を CSV から取り込む")
        print("  check-connection                 MT5 接続を確認する")
        print("  verify-range <SYMBOL>            銘柄のデータ取得可能期間を確認する")
        sys.exit(1)

    command = sys.argv[1]
    rest = sys.argv[2:]

    if command == "update-events":
        csv_path = _extract_flag(rest, "--csv-path")
        cmd_update_events(csv_path)
    elif command == "check-connection":
        cmd_check_connection()
    elif command == "verify-range":
        if not rest:
            _print_err("verify-range には銘柄名が必要です。例: market-data verify-range USDJPY")
            sys.exit(1)
        cmd_verify_range(rest[0])
    else:
        _print_err(f"不明なコマンド: {command}")
        sys.exit(1)
