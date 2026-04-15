from django.contrib import admin
from .models import CategorieOeuf, Race, Client, Depot, Alerte, Palette, TransactionCaisse


@admin.register(Palette)
class PaletteAdmin(admin.ModelAdmin):
    list_display = ('numero', 'created_at')
    ordering = ('numero',)


@admin.register(CategorieOeuf)
class CategorieOeufAdmin(admin.ModelAdmin):
    list_display = ('nom', 'duree_incubation_jours', 'temperature_recommandee', 'created_at')
    search_fields = ('nom',)
    ordering = ('nom',)


@admin.register(Race)
class RaceAdmin(admin.ModelAdmin):
    list_display = ('nom', 'categorie', 'created_at')
    list_filter = ('categorie',)
    search_fields = ('nom',)
    ordering = ('categorie', 'nom')


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ('nom', 'prenom', 'telephone', 'email', 'est_actif')
    search_fields = ('nom', 'prenom', 'telephone')
    list_filter = ('est_actif',)
    ordering = ('nom',)


@admin.register(Depot)
class DepotAdmin(admin.ModelAdmin):
    list_display = ('client', 'race', 'palette', 'date_heure_depôt', 'quantite_oeufs', 'statut', 'date_eclosion_prevue', 'alerte_perso_active')
    list_filter = ('statut', 'race__categorie', 'date_heure_depôt', 'alerte_perso_active')
    search_fields = ('client__nom', 'race__nom')
    ordering = ('-date_heure_depôt',)
    fieldsets = (
        ('Informations principales', {
            'fields': ('client', 'race', 'palette', 'statut')
        }),
        ('Quantités et prix', {
            'fields': ('quantite_oeufs', 'quantite_eclos', 'prix_unitaire', 'montant_percu')
        }),
        ('Dates', {
            'fields': ('date_heure_depôt', 'date_eclosion_prevue')
        }),
        ('Alerte personnalisée', {
            'fields': ('alerte_perso_active', 'alerte_perso_date', 'alerte_perso_message'),
            'classes': ('collapse',)
        }),
        ('Remarques', {
            'fields': ('remarque',)
        }),
    )


@admin.register(Alerte)
class AlerteAdmin(admin.ModelAdmin):
    list_display = ('depot', 'type_alerte', 'date_prevue', 'est_lue')
    list_filter = ('type_alerte', 'est_lue')
    ordering = ('-date_prevue',)


@admin.register(TransactionCaisse)
class TransactionCaisseAdmin(admin.ModelAdmin):
    list_display = ('date_transaction', 'type_transaction', 'categorie', 'montant', 'client', 'reference')
    list_filter = ('type_transaction', 'categorie', 'date_transaction')
    search_fields = ('description', 'reference', 'client__nom')
    ordering = ('-date_transaction',)
    date_hierarchy = 'date_transaction'
