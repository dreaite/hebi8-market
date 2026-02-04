"use client";

import { useEffect, useState } from "react";
import { SourceForm } from "./SourceForm";

interface DataSource {
  id: string;
  name: string;
  type: string;
  config: string;
}

interface SourceManagerProps {
  onSelect: (sourceId: string) => void;
  selectedSourceId?: string;
}

export const SourceManager = ({ onSelect, selectedSourceId }: SourceManagerProps) => {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchSources = async () => {
    try {
      const res = await fetch("/api/sources");
      const data = await res.json();
      setSources(data);
    } catch (error) {
      console.error("Failed to fetch sources", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  return (
    <div className="flex flex-col h-full border-r bg-gray-50">
      <div className="p-4 border-b flex justify-between items-center bg-white">
        <h2 className="font-semibold text-gray-900">数据源</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          {showForm ? "取消" : "添加"}
        </button>
      </div>

      {showForm && (
        <div className="p-4 border-b bg-gray-100">
          <SourceForm onSuccess={() => {
            fetchSources();
            setShowForm(false);
          }} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-gray-500">加载中...</div>
        ) : sources.length === 0 ? (
          <div className="p-4 text-center text-gray-500">暂无数据源</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {sources.map((source) => (
              <li
                key={source.id}
                onClick={() => onSelect(source.id)}
                className={`p-4 cursor-pointer hover:bg-gray-100 transition-colors ${
                  selectedSourceId === source.id ? "bg-blue-50 border-l-4 border-blue-600" : ""
                }`}
              >
                <div className="font-medium text-gray-900">{source.name}</div>
                <div className="text-xs text-gray-500 mt-1">{source.type}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
