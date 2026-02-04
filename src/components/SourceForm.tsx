"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SourceFormProps {
  onSuccess?: () => void;
}

export const SourceForm = ({ onSuccess }: SourceFormProps) => {
  const [name, setName] = useState("");
  const [type, setType] = useState("EXTERNAL_URL");
  const [config, setConfig] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Validate JSON config
      try {
        JSON.parse(config);
      } catch {
        alert("Invalid JSON config");
        setIsLoading(false);
        return;
      }

      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, config: JSON.parse(config) }),
      });

      if (!res.ok) {
        throw new Error("Failed to create source");
      }

      setName("");
      setType("EXTERNAL_URL");
      setConfig("");
      router.refresh();
      onSuccess?.();
    } catch (error) {
      console.error(error);
      alert("Failed to create source");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-lg bg-white shadow-sm">
      <h3 className="text-lg font-semibold">添加数据源</h3>
      
      <div>
        <label className="block text-sm font-medium text-gray-700">名称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2 focus:ring-blue-500 focus:border-blue-500"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">类型</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2 bg-white focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="EXTERNAL_URL">外部 URL</option>
          <option value="LOCAL_DB">本地数据库</option>
          <option value="API_SUBSCRIPTION">API 订阅</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">配置 (JSON)</label>
        <textarea
          value={config}
          onChange={(e) => setConfig(e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2 font-mono text-sm focus:ring-blue-500 focus:border-blue-500"
          rows={4}
          placeholder='{ "url": "https://api.example.com/data" }'
          required
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300"
      >
        {isLoading ? "保存中..." : "保存"}
      </button>
    </form>
  );
};
