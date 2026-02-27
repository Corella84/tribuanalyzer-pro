// lib/api/test-connection.ts
// Utilidad para probar la conexión con el backend Flask

import { apiClient } from './client';

/**
 * Prueba la conexión con el backend Flask
 * Útil para verificar que la configuración es correcta
 */
export async function testBackendConnection(): Promise<{
  success: boolean;
  baseUrl: string;
  message: string;
  error?: string;
}> {
  const baseUrl = apiClient.getBaseUrl();

  try {
    // Intenta hacer una petición simple al backend
    // Ajusta el endpoint según tu API Flask
    const response = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      return {
        success: true,
        baseUrl,
        message: 'Conexión exitosa con el backend Flask',
      };
    } else {
      return {
        success: false,
        baseUrl,
        message: `El backend respondió con código ${response.status}`,
        error: response.statusText,
      };
    }
  } catch (error) {
    // Detectar si es un error de red (backend caído)
    const isNetworkError = error instanceof TypeError && error.message.includes('fetch');

    return {
      success: false,
      baseUrl,
      message: isNetworkError
        ? 'No se pudo conectar con el backend. Verifica que esté corriendo en el puerto 5001.'
        : 'Error al conectar con el backend',
      error: error instanceof Error ? error.message : 'Error desconocido',
    };
  }
}
