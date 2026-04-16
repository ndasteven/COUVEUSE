"""
Processeurs de contexte personnalisés pour le projet Couveuse
"""

from django.conf import settings

def websocket_config(request):
    """
    Injecte la configuration WebSocket dans tous les templates
    """
    return {
        'WS_URL': getattr(settings, 'WS_URL', 'http://localhost:3001')
    }