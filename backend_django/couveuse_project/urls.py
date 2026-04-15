from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView
from rest_framework.routers import DefaultRouter
from couveuse_app import views

# Routeur API
router = DefaultRouter()
router.register(r'palettes', views.PaletteViewSet)
router.register(r'categories', views.CategorieOeufViewSet)
router.register(r'races', views.RaceViewSet)
router.register(r'clients', views.ClientViewSet)
router.register(r'depots', views.DepotViewSet)
router.register(r'alertes', views.AlerteViewSet)
router.register(r'transactions', views.TransactionCaisseViewSet)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include(router.urls)),
    path('api/alertes-non-lues/', views.alertes_non_lues, name='alertes-non-lues'),
    path('api/alertes/<int:pk>/lire/', views.marquer_alerte_lue, name='marquer-alerte-lue'),
    path('api/dashboard-stats/', views.dashboard_stats, name='dashboard-stats'),
    path('api/palettes-disponibles/', views.palettes_disponibles, name='palettes-disponibles'),
    path('api/caisse/dashboard/', views.caisse_dashboard, name='caisse-dashboard'),
    path('api/caisse/rapport/', views.caisse_rapport, name='caisse-rapport'),
    # Paramètres
    path('api/parametres/', views.get_parametres, name='get-parametres'),
    path('api/parametres/update/', views.update_parametres, name='update-parametres'),
    path('api/parametres/verifier-code/', views.verifier_code_pin, name='verifier-code-pin'),
    path('api/parametres/changer-code/', views.changer_code_pin, name='changer-code-pin'),
    path('api/parametres/activer-code/', views.activer_code_pin, name='activer-code-pin'),
    path('api/parametres/upload-son/', views.upload_son_alerte, name='upload-son-alerte'),
    path('', TemplateView.as_view(template_name='couveuse_app/index.html')),
]
