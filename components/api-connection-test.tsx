'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { testBackendConnection } from '@/lib/api/test-connection';
import { getCampaigns, getDashboardStats } from '@/lib/api/meta-ads';

interface ConnectionStatus {
  status: 'checking' | 'success' | 'error';
  message: string;
  baseUrl: string;
  error?: string;
}

export default function ApiConnectionTest() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    status: 'checking',
    message: 'Verificando conexión...',
    baseUrl: apiClient.getBaseUrl(),
  });
  const [campaignsData, setCampaignsData] = useState<any>(null);
  const [statsData, setStatsData] = useState<any>(null);
  const [extensionData, setExtensionData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    setConnectionStatus({
      status: 'checking',
      message: 'Verificando conexión con el backend...',
      baseUrl: apiClient.getBaseUrl(),
    });

    try {
      const result = await testBackendConnection();
      setConnectionStatus({
        status: result.success ? 'success' : 'error',
        message: result.message,
        baseUrl: result.baseUrl,
        error: result.error,
      });
    } catch (error) {
      setConnectionStatus({
        status: 'error',
        message: 'Error al verificar la conexión',
        baseUrl: apiClient.getBaseUrl(),
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  };

  const testGetCampaigns = async () => {
    setLoading(true);
    try {
      const data = await getCampaigns();
      setCampaignsData(data);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      setCampaignsData({
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    } finally {
      setLoading(false);
    }
  };

  const testGetStats = async () => {
    setLoading(true);
    try {
      const data = await getDashboardStats();
      setStatsData(data);
    } catch (error) {
      console.error('Error fetching stats:', error);
      setStatsData({
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    } finally {
      setLoading(false);
    }
  };

  const testExtensionEndpoint = async () => {
    setLoading(true);
    try {
      const data = await apiClient.post('/api/extension', {
        campaign_id: '120212240998700256'
      });

      // Validar que la respuesta tenga los campos esperados
      if (!data || typeof data !== 'object') {
        throw new Error('Respuesta inválida del backend');
      }

      if (!('signal' in data)) {
        throw new Error('Respuesta incompleta: falta el campo "signal"');
      }

      setExtensionData(data);
    } catch (error) {
      console.error('Error calling extension endpoint:', error);
      setExtensionData({
        error: error instanceof Error ? error.message : 'Error desconocido',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">
          Prueba de Conexión API
        </h2>

        {/* Estado de la conexión */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-sm font-medium text-slate-600">URL Base:</span>
            <code className="px-2 py-1 bg-slate-100 rounded text-sm text-slate-800">
              {connectionStatus.baseUrl}
            </code>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm font-medium text-slate-600">Estado:</span>
            {connectionStatus.status === 'checking' && (
              <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm">
                Verificando...
              </span>
            )}
            {connectionStatus.status === 'success' && (
              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                ✓ Conectado
              </span>
            )}
            {connectionStatus.status === 'error' && (
              <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm">
                ✗ Error de conexión
              </span>
            )}
          </div>

          <div className="bg-slate-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-slate-700">{connectionStatus.message}</p>
            {connectionStatus.error && (
              <p className="text-sm text-red-600 mt-2">
                Error: {connectionStatus.error}
              </p>
            )}
          </div>

          <button
            onClick={checkConnection}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-sm"
          >
            Reintentar Conexión
          </button>
        </div>

        {/* Pruebas de endpoints */}
        <div className="space-y-4 border-t border-gray-200 pt-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">
            Probar Endpoints del Dashboard
          </h3>

          <div className="flex gap-4">
            <button
              onClick={testGetCampaigns}
              disabled={loading || connectionStatus.status === 'error'}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm"
            >
              {loading ? 'Cargando...' : 'Obtener Campañas'}
            </button>

            <button
              onClick={testGetStats}
              disabled={loading || connectionStatus.status === 'error'}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm"
            >
              {loading ? 'Cargando...' : 'Obtener Estadísticas'}
            </button>

            <button
              onClick={testExtensionEndpoint}
              disabled={loading || connectionStatus.status === 'error'}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm"
            >
              {loading ? 'Cargando...' : 'Probar Análisis ROAS'}
            </button>
          </div>

          {/* Resultados */}
          {campaignsData && (
            <div className="mt-4 bg-blue-50 rounded-lg p-4">
              <h4 className="font-semibold text-blue-900 mb-2">
                Resultado: Campañas
              </h4>
              <pre className="text-xs overflow-auto bg-white p-3 rounded border border-blue-200">
                {JSON.stringify(campaignsData, null, 2)}
              </pre>
            </div>
          )}

          {statsData && (
            <div className="mt-4 bg-purple-50 rounded-lg p-4">
              <h4 className="font-semibold text-purple-900 mb-2">
                Resultado: Estadísticas
              </h4>
              <pre className="text-xs overflow-auto bg-white p-3 rounded border border-purple-200">
                {JSON.stringify(statsData, null, 2)}
              </pre>
            </div>
          )}

          {extensionData && (
            <div className="mt-4 bg-green-50 rounded-lg p-4">
              <h4 className="font-semibold text-green-900 mb-2">
                Resultado: Análisis ROAS
              </h4>
              {extensionData.error ? (
                <p className="text-sm text-red-600">{extensionData.error}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm">
                    <span className="font-medium">Signal:</span> {extensionData.signal}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Reasoning:</span> {extensionData.reasoning}
                  </p>
                  {extensionData.roas !== undefined && (
                    <p className="text-sm">
                      <span className="font-medium">ROAS:</span> {extensionData.roas}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
