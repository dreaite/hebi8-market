"use client";

import { useState, useEffect } from "react";
import { SourceManager } from "@/components/SourceManager";
import { Chart } from "@/components/Chart";
import { Candle } from "@/lib/adapters";

export default function Home() {
  const [selectedSourceId, setSelectedSourceId] = useState<string | undefined>();
  const [symbol, setSymbol] = useState("BTCUSD");
  const [data, setData] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!selectedSourceId || !symbol) return;

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `/api/data?sourceId=${selectedSourceId}&symbol=${symbol}`
        );
        
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error || "Failed to fetch data");
        }

        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : "An error occurred");
        setData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedSourceId, symbol]);

  return (
    <div className="flex h-screen bg-gray-50 text-black">
      {/* Sidebar */}
      <div className="w-80 flex-shrink-0 bg-white shadow-md z-10">
        <SourceManager
          onSelect={setSelectedSourceId}
          selectedSourceId={selectedSourceId}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">TradingView Dashboard</h1>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <label htmlFor="symbol" className="text-sm font-medium text-gray-700">
                交易对:
              </label>
              <input
                id="symbol"
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="BTCUSD"
              />
            </div>
          </div>
        </header>

        {/* Chart Area */}
        <main className="flex-1 p-6 overflow-hidden flex flex-col">
          <div className="flex-1 bg-white rounded-lg shadow border border-gray-200 relative">
            {selectedSourceId ? (
              <>
                {loading && (
                  <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                )}
                
                {error && (
                  <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                    <div className="bg-red-50 text-red-700 px-4 py-2 rounded-md shadow border border-red-200">
                      Error: {error}
                    </div>
                  </div>
                )}

                <div className="w-full h-full p-4">
                  <Chart data={data} />
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                请从左侧选择一个数据源以开始
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
