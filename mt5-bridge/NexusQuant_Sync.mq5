//+------------------------------------------------------------------+
//|                                            NexusQuant_Sync.mq5  |
//|                       Copyright 2026, NexusQuant SaaS Automated  |
//|                                https://trading-bot-lm51.onrender.com |
//+------------------------------------------------------------------+
#property copyright "NexusQuant SaaS Platform"
#property link      "https://trading-bot-lm51.onrender.com"
#property version   "2.00"
#property description "Zero-Cost Automated Cloud Sync EA for NexusQuant Clients"
#property description "Syncs real-time balance/equity and executes 500x margin scalps"

#include <Trade\Trade.mqh>
CTrade trade;

//--- Inputs
input string   InpSyncToken       = "YOUR_SYNC_TOKEN"; // Your Personal Sync Token (From Web Dashboard)
input string   InpServerUrl       = "https://trading-bot-lm51.onrender.com/api/broker/mt5/sync"; // SaaS Endpoint
input int      InpHeartbeatSec    = 2;                       // Sync Interval (Seconds)
input double   InpMaxSlippage     = 10.0;                    // Max Slippage in Points
input ulong    InpMagicNumber     = 241100;                  // Magic Number

int OnInit()
{
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints((ulong)InpMaxSlippage);
   trade.SetTypeFilling(ORDER_FILLING_IOC);
   
   Print("======================================================");
   Print("[NexusQuant] Initializing Cloud Sync Connector v2.0");
   Print("[NexusQuant] Server URL: ", InpServerUrl);
   Print("[NexusQuant] Token: ", InpSyncToken);
   Print("[NexusQuant] Account: ", AccountInfoInteger(ACCOUNT_LOGIN));
   Print("======================================================");
   
   EventSetTimer(InpHeartbeatSec);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("[NexusQuant] Cloud Sync Disconnected.");
}

void OnTimer()
{
   if(InpSyncToken == "" || InpSyncToken == "YOUR_SYNC_TOKEN")
   {
      Print("[NexusQuant] WARNING: Please set your personal InpSyncToken in EA inputs!");
      return;
   }
   
   long   login      = AccountInfoInteger(ACCOUNT_LOGIN);
   string server     = AccountInfoString(ACCOUNT_SERVER);
   double balance    = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity     = AccountInfoDouble(ACCOUNT_EQUITY);
   double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   long   leverage   = AccountInfoInteger(ACCOUNT_LEVERAGE);
   string currency   = AccountInfoString(ACCOUNT_CURRENCY);
   
   string payload = StringFormat("{\"syncToken\":\"%s\",\"login\":%I64d,\"server\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f,\"leverage\":%I64d,\"currency\":\"%s\"}", InpSyncToken, login, server, balance, equity, freeMargin, leverage, currency);
   char postData[];
   char result[];
   string result_headers;
   StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(postData, ArraySize(postData)-1);
   string headers = "Content-Type: application/json\r\n";
   ResetLastError();
   int res = WebRequest("POST", InpServerUrl, headers, 3000, postData, result, result_headers);
   if(res == 200)
   {
      string responseText = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      ExecutePendingOrders(responseText);
   }
   else if(res == -1)
   {
      int err = GetLastError();
      if(err == 4014) Print("[NexusQuant ERROR] WebRequest not allowed! Add URL to Tools -> Options -> Expert Advisors -> Allow WebRequest");
   }
}

void ExecutePendingOrders(string json)
{
   if(StringFind(json, "orders") < 0) return;
   int actionPos = StringFind(json, "action");
   if(actionPos < 0) return;
   string action = "";
   int start = actionPos + 9;
   int end = StringFind(json, "\"", start);
   if(end > start) action = StringSubstr(json, start, end - start);
   string sym = _Symbol;
   int symPos = StringFind(json, "symbol");
   if(symPos > 0) {
      int sStart = symPos + 9;
      int sEnd = StringFind(json, "\"", sStart);
      if(sEnd > sStart) sym = StringSubstr(json, sStart, sEnd - sStart);
   }
   double vol = 0.01;
   int volPos = StringFind(json, "volume");
   if(volPos > 0) {
      int vStart = volPos + 8;
      int vEnd = StringFind(json, ",", vStart);
      if(vEnd < 0) vEnd = StringFind(json, "}", vStart);
      if(vEnd > vStart) vol = StringToDouble(StringSubstr(json, vStart, vEnd - vStart));
   }
   double sl = 0;
   int slPos = StringFind(json, "sl");
   if(slPos > 0) {
      int slStart = slPos + 4;
      int slEnd = StringFind(json, ",", slStart);
      if(slEnd < 0) slEnd = StringFind(json, "}", slStart);
      if(slEnd > slStart) sl = StringToDouble(StringSubstr(json, slStart, slEnd - slStart));
   }
   double tp = 0;
   int tpPos = StringFind(json, "tp");
   if(tpPos > 0) {
      int tpStart = tpPos + 4;
      int tpEnd = StringFind(json, ",", tpStart);
      if(tpEnd < 0) tpEnd = StringFind(json, "}", tpStart);
      if(tpEnd > tpStart) tp = StringToDouble(StringSubstr(json, tpStart, tpEnd - tpStart));
   }
   PrintFormat("[NexusQuant] Scalp Order: %s %s %.2f lots (SL: %.5f, TP: %.5f)", action, sym, vol, sl, tp);
   if(action == "BUY") trade.Buy(vol, sym, 0, sl, tp, "NexusQuant Scalp");
   else if(action == "SELL") trade.Sell(vol, sym, 0, sl, tp, "NexusQuant Scalp");
}
