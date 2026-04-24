//+------------------------------------------------------------------+
//| EconomicCalendarExport.mq5                                        |
//| MT5 経済カレンダーを CSV に書き出すスクリプト。                     |
//|                                                                   |
//| 出力先: <MT5 Files フォルダ>/economic_calendar.csv                 |
//| 形式:  event_time (ISO 8601 UTC), currency, name, importance,     |
//|        actual, forecast, previous                                 |
//|                                                                   |
//| 使い方: MT5 で本スクリプトをコンパイル後、任意のチャートにドラッグ |
//|         して実行する。実行中は何度でも上書き出力可能。             |
//|                                                                   |
//| 仕様: 仕様書 §5.4 + §16 Phase 2c                                  |
//+------------------------------------------------------------------+
#property copyright "trade-training"
#property version   "1.00"
#property script_show_inputs
#property strict

input int    InpMonthsBack    = 6;       // 過去何ヶ月分を取得するか
input int    InpMonthsForward = 1;       // 未来何ヶ月分を取得するか(予定発表分)
input int    InpImportanceMin = 1;       // 出力する最低重要度(1-3)
input string InpOutputFile    = "economic_calendar.csv"; // 出力ファイル名

//+------------------------------------------------------------------+
//| CSV 用文字列エスケープ(カンマ・ダブルクォート・改行対応)         |
//+------------------------------------------------------------------+
string CsvEscape(const string s)
{
   if(StringFind(s, ",") < 0 && StringFind(s, "\"") < 0 && StringFind(s, "\n") < 0)
      return s;
   string r = s;
   StringReplace(r, "\"", "\"\"");
   return "\"" + r + "\"";
}

//+------------------------------------------------------------------+
//| datetime → ISO 8601 UTC 文字列                                    |
//+------------------------------------------------------------------+
string IsoUtc(const datetime t)
{
   MqlDateTime dt;
   TimeToStruct(t, dt);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
                       dt.year, dt.mon, dt.day,
                       dt.hour, dt.min, dt.sec);
}

//+------------------------------------------------------------------+
//| double → CSV 文字列(DBL_MIN/空は空欄)                            |
//+------------------------------------------------------------------+
string ValOrEmpty(const long v, const bool has_value)
{
   // MT5 の calendar 値は 1e6 倍整数で返ってくる
   if(!has_value)
      return "";
   return DoubleToString(v / 1000000.0, 6);
}

//+------------------------------------------------------------------+
//| importance enum → 1-3 整数                                        |
//+------------------------------------------------------------------+
int ImportanceToInt(const ENUM_CALENDAR_EVENT_IMPORTANCE imp)
{
   switch(imp)
   {
      case CALENDAR_IMPORTANCE_LOW:      return 1;
      case CALENDAR_IMPORTANCE_MODERATE: return 2;
      case CALENDAR_IMPORTANCE_HIGH:     return 3;
      default: return 0;  // CALENDAR_IMPORTANCE_NONE
   }
}

//+------------------------------------------------------------------+
//| Script program start function                                     |
//+------------------------------------------------------------------+
void OnStart()
{
   datetime to   = TimeCurrent() + InpMonthsForward * 30 * 86400;
   datetime from = TimeCurrent() - InpMonthsBack    * 30 * 86400;

   MqlCalendarValue values[];
   int n = CalendarValueHistory(values, from, to, NULL, NULL);
   if(n <= 0)
   {
      PrintFormat("CalendarValueHistory returned 0 rows (error=%d)", GetLastError());
      return;
   }

   int fh = FileOpen(InpOutputFile, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(fh == INVALID_HANDLE)
   {
      PrintFormat("FileOpen failed: %s (error=%d)", InpOutputFile, GetLastError());
      return;
   }

   FileWriteString(fh, "event_time,currency,name,importance,actual,forecast,previous\n");

   int written = 0;
   for(int i = 0; i < n; i++)
   {
      MqlCalendarEvent event;
      if(!CalendarEventById(values[i].event_id, event))
         continue;

      int importance = ImportanceToInt(event.importance);
      if(importance < InpImportanceMin)
         continue;

      MqlCalendarCountry country;
      if(!CalendarCountryById(event.country_id, country))
         continue;

      string currency = country.currency;
      if(StringLen(currency) == 0)
         continue;

      string line = StringFormat("%s,%s,%s,%d,%s,%s,%s\n",
         IsoUtc(values[i].time),
         CsvEscape(currency),
         CsvEscape(event.name),
         importance,
         ValOrEmpty(values[i].actual_value,   values[i].actual_value   != LONG_MIN),
         ValOrEmpty(values[i].forecast_value, values[i].forecast_value != LONG_MIN),
         ValOrEmpty(values[i].prev_value,     values[i].prev_value     != LONG_MIN)
      );
      FileWriteString(fh, line);
      written++;
   }

   FileClose(fh);
   PrintFormat("Wrote %d / %d events to %s", written, n, InpOutputFile);
}
//+------------------------------------------------------------------+
