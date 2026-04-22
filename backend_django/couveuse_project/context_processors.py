"""
Processeurs de contexte personnalisés pour le projet Couveuse
"""

from django.conf import settings

def websocket_config(request):
    """
    Injecte la configuration WebSocket dans tous les templates
    """
    # En production, on préférera peut-être utiliser le protocole relatif
    # ou une variable d'environnement spécifique
    ws_url = getattr(settings, 'WS_URL', 'http://localhost:3001')
    
    return {
        'WS_URL': ws_url,
        'WS_DEBUG': settings.DEBUG
    }