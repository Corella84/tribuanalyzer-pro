// lib/api/client.ts
// Cliente API para conectar con el backend Flask

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:5001';

/**
 * Cliente API para realizar peticiones al backend Flask
 */
class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  /**
   * Realiza una petición GET al backend
   */
  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const jsonData = await response.json();
      return jsonData;
    } catch (error) {
      // Error de red o backend caído
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('No se pudo conectar con el backend. Verifica que esté corriendo.');
      }
      // Re-lanzar otros errores
      throw error;
    }
  }

  /**
   * Realiza una petición POST al backend
   */
  async post<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        body: data ? JSON.stringify(data) : undefined,
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const jsonData = await response.json();
      return jsonData;
    } catch (error) {
      // Error de red o backend caído
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('No se pudo conectar con el backend. Verifica que esté corriendo.');
      }
      // Re-lanzar otros errores
      throw error;
    }
  }

  /**
   * Realiza una petición PUT al backend
   */
  async put<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Realiza una petición DELETE al backend
   */
  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Obtiene la URL base configurada
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}

// Exportar una instancia singleton del cliente
export const apiClient = new ApiClient();

// Exportar también la clase por si se necesita crear instancias personalizadas
export default ApiClient;
