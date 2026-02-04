"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, CandlestickSeries } from "lightweight-charts";
import { Candle } from "@/lib/adapters";

interface ChartProps {
  data: Candle[];
  colors?: {
    backgroundColor?: string;
    lineColor?: string;
    textColor?: string;
    areaTopColor?: string;
    areaBottomColor?: string;
  };
}

export const Chart = ({ data, colors = {} }: ChartProps) => {
  const {
    backgroundColor = "white",
    textColor = "black",
  } = colors;

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: backgroundColor },
        textColor,
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
    });

    chart.timeScale().fitContent();

    // Use addSeries instead of addCandlestickSeries (API change in v4/v5)
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', 
      downColor: '#ef5350', 
      borderVisible: false, 
      wickUpColor: '#26a69a', 
      wickDownColor: '#ef5350'
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [backgroundColor, textColor]);

  useEffect(() => {
    if (seriesRef.current && data) {
      const mappedData = data.map(d => ({
        time: d.time as any,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      } as CandlestickData));
      
      seriesRef.current.setData(mappedData);
      
      if (chartRef.current) {
         chartRef.current.timeScale().fitContent();
      }
    }
  }, [data]);

  return (
    <div 
      ref={chartContainerRef} 
      className="w-full h-full min-h-[400px]"
    />
  );
};
