from rest_framework import viewsets, status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from datetime import timedelta
from django.db.models import Sum, Count
from django.db.models.functions import TruncMonth, TruncWeek, TruncDay
from .models import CategorieOeuf, Race, Client, Depot, Alerte, Palette, TransactionCaisse, Parametre
from .serializers import (
    CategorieOeufSerializer,
    RaceSerializer,
    ClientSerializer,
    DepotSerializer,
    AlerteSerializer,
    PaletteSerializer,
    TransactionCaisseSerializer,
    ParametreSerializer
)


class PaletteViewSet(viewsets.ModelViewSet):
    queryset = Palette.objects.prefetch_related('depots__client', 'depots__race__categorie').all()
    serializer_class = PaletteSerializer


class CategorieOeufViewSet(viewsets.ModelViewSet):
    queryset = CategorieOeuf.objects.all()
    serializer_class = CategorieOeufSerializer


class RaceViewSet(viewsets.ModelViewSet):
    queryset = Race.objects.all()
    serializer_class = RaceSerializer


class ClientViewSet(viewsets.ModelViewSet):
    queryset = Client.objects.all()
    serializer_class = ClientSerializer


class DepotViewSet(viewsets.ModelViewSet):
    queryset = Depot.objects.select_related('client', 'race__categorie').all()
    serializer_class = DepotSerializer

    # Les alertes sont créées par Node.js automatiquement quand la date arrive
    # Pas besoin de les créer ici


class AlerteViewSet(viewsets.ModelViewSet):
    queryset = Alerte.objects.select_related('depot__client', 'depot__race').all()
    serializer_class = AlerteSerializer


@api_view(['GET'])
def alertes_non_lues(request):
    """Renvoie les alertes non lues"""
    alertes = Alerte.objects.filter(est_lue=False).order_by('-date_prevue')
    serializer = AlerteSerializer(alertes, many=True)
    return Response(serializer.data)


@api_view(['POST'])
def marquer_alerte_lue(request, pk):
    """Marque une alerte comme lue, change le statut du dépôt et libère la palette"""
    try:
        alerte = Alerte.objects.get(pk=pk)
        alerte.est_lue = True
        alerte.date_envoyee = timezone.now()
        alerte.save()
        
        # Si c'est une alerte d'éclosion (jour_j), changer le statut du dépôt à "éclos" et libérer la palette
        if alerte.type_alerte == 'jour_j' and alerte.depot:
            depot = alerte.depot
            palette_liberee = None
            
            # Libérer la palette si elle est encore attachée (même si le statut est déjà eclos)
            if depot.palette:
                palette_liberee = depot.palette.numero
                depot.palette = None

            # Changer le statut si encore en cours
            if depot.statut == 'en_cours':
                depot.statut = 'eclos'

            depot.save()

            return Response({
                'success': True,
                'depot_updated': True,
                'nouveau_statut': 'eclos',
                'depot_id': depot.id,
                'palette_liberee': palette_liberee,
                'message': f'Dépôt #{depot.id} marqué comme éclos' + (f' — Palette {palette_liberee} libérée' if palette_liberee else '')
            })
        
        return Response({'success': True})
    except Alerte.DoesNotExist:
        return Response(
            {'error': 'Alerte non trouvée'},
            status=status.HTTP_404_NOT_FOUND
        )


@api_view(['GET'])
def dashboard_stats(request):
    """Statistiques pour le tableau de bord"""
    depots_en_cours = Depot.objects.filter(statut='en_cours')
    aujourdHui = timezone.now().date()

    stats = {
        'total_depots': depots_en_cours.count(),
        'total_oeufs': sum(d.quantite_oeufs for d in depots_en_cours),
        'eclosions_aujourdhui': depots_en_cours.filter(
            date_eclosion_prevue=aujourdHui
        ).count(),
        'alertes_non_lues': Alerte.objects.filter(est_lue=False).count(),
    }

    return Response(stats)


@api_view(['GET'])
def palettes_disponibles(request):
    """Renvoie la liste des palettes disponibles"""
    palettes = Palette.objects.filter(est_disponible=True).order_by('numero')
    serializer = PaletteSerializer(palettes, many=True)
    return Response(serializer.data)


class TransactionCaisseViewSet(viewsets.ModelViewSet):
    """ViewSet pour gérer les transactions de caisse"""
    queryset = TransactionCaisse.objects.select_related('client', 'depot').all()
    serializer_class = TransactionCaisseSerializer
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Filtres optionnels
        type_trans = self.request.query_params.get('type')
        if type_trans:
            queryset = queryset.filter(type_transaction=type_trans)
        
        categorie = self.request.query_params.get('categorie')
        if categorie:
            queryset = queryset.filter(categorie=categorie)
        
        date_debut = self.request.query_params.get('date_debut')
        if date_debut:
            queryset = queryset.filter(date_transaction__gte=date_debut)
        
        date_fin = self.request.query_params.get('date_fin')
        if date_fin:
            queryset = queryset.filter(date_transaction__lte=date_fin)
        
        client_id = self.request.query_params.get('client')
        if client_id:
            queryset = queryset.filter(client_id=client_id)
        
        return queryset


@api_view(['GET'])
def caisse_dashboard(request):
    """Statistiques complètes du tableau de bord caisse"""
    from django.db.models.functions import TruncMonth, TruncWeek, TruncDay
    from datetime import datetime, timedelta as py_timedelta
    
    # Récupérer les paramètres de filtre
    date_debut = request.query_params.get('date_debut')
    date_fin = request.query_params.get('date_fin')
    periode = request.query_params.get('periode', 'mois')  # jour, semaine, mois, annee
    
    today = timezone.now().date()
    
    # Définir les dates par défaut selon la période
    if not date_debut:
        if periode == 'jour':
            date_debut = today.isoformat()
        elif periode == 'semaine':
            date_debut = (today - timedelta(days=7)).isoformat()
        elif periode == 'mois':
            date_debut = (today - timedelta(days=30)).isoformat()
        else:  # annee
            date_debut = (today - timedelta(days=365)).isoformat()
    
    if not date_fin:
        date_fin = today.isoformat()
    
    # Filtrer les transactions par date
    transactions = TransactionCaisse.objects.filter(
        date_transaction__gte=date_debut,
        date_transaction__lte=date_fin
    )
    
    # === STATISTIQUES GÉNÉRALES ===
    # Transactions de caisse manuelles
    total_entrees_transactions = transactions.filter(type_transaction='entree').aggregate(
        total=Sum('montant')
    )['total'] or 0
    
    total_sorties = transactions.filter(type_transaction='sortie').aggregate(
        total=Sum('montant')
    )['total'] or 0
    
    # === REVENUS DES DÉPÔTS (entrées automatiques) ===
    # Inclure les montants perçus des dépôts dans les entrées
    depot_entrees = Depot.objects.filter(
        date_heure_depôt__date__gte=date_debut,
        date_heure_depôt__date__lte=date_fin
    ).aggregate(
        total=Sum('montant_percu')
    )['total'] or 0
    
    # Total des entrées = transactions + dépôts
    total_entrees = float(total_entrees_transactions) + float(depot_entrees)
    
    solde = total_entrees - total_sorties
    
    # Compter le nombre de transactions
    nb_entrees = transactions.filter(type_transaction='entree').count()
    nb_sorties = transactions.filter(type_transaction='sortie').count()
    
    # === DONNÉES POUR GRAPHIQUE D'ÉVOLUTION ===
    # Évolution par jour/semaine/mois selon la période
    if periode == 'jour':
        trunc_func = TruncDay('date_transaction')
    elif periode == 'semaine':
        trunc_func = TruncWeek('date_transaction')
    elif periode == 'mois':
        trunc_func = TruncMonth('date_transaction')
    else:
        trunc_func = TruncMonth('date_transaction')
    
    # Évolution des entrées (transactions manuelles)
    evolution_entrees = transactions.filter(type_transaction='entree').annotate(
        periode=trunc_func
    ).values('periode').annotate(
        total=Sum('montant')
    ).order_by('periode')
    
    # Évolution des sorties
    evolution_sorties = transactions.filter(type_transaction='sortie').annotate(
        periode=trunc_func
    ).values('periode').annotate(
        total=Sum('montant')
    ).order_by('periode')
    
    # === ÉVOLUTION DES DÉPÔTS (entrées automatiques) ===
    # Grouper les dépôts par période
    if periode == 'jour':
        depot_trunc = TruncDay('date_heure_depôt')
    elif periode == 'semaine':
        depot_trunc = TruncWeek('date_heure_depôt')
    elif periode == 'mois':
        depot_trunc = TruncMonth('date_heure_depôt')
    else:
        depot_trunc = TruncMonth('date_heure_depôt')
    
    evolution_depots = Depot.objects.filter(
        date_heure_depôt__date__gte=date_debut,
        date_heure_depôt__date__lte=date_fin
    ).annotate(
        periode=depot_trunc
    ).values('periode').annotate(
        total=Sum('montant_percu')
    ).order_by('periode')
    
    # Formater les données pour les graphiques
    def format_evolution(data):
        return [
            {
                'date': item['periode'].strftime('%Y-%m-%d') if item['periode'] else None,
                'total': float(item['total'] or 0)
            }
            for item in data
        ]
    
    # Combiner les évolutions : transactions + dépôts
    def combiner_evolutions(evolution_trans, evolution_deps):
        # Créer un dictionnaire avec toutes les dates
        result = {}
        
        # Ajouter les transactions
        for item in evolution_trans:
            date_key = item['periode'].strftime('%Y-%m-%d') if item['periode'] else None
            if date_key:
                result[date_key] = result.get(date_key, 0) + float(item['total'] or 0)
        
        # Ajouter les dépôts
        for item in evolution_deps:
            date_key = item['periode'].strftime('%Y-%m-%d') if item['periode'] else None
            if date_key:
                result[date_key] = result.get(date_key, 0) + float(item['total'] or 0)
        
        # Convertir en liste triée
        return [
            {'date': date, 'total': total}
            for date, total in sorted(result.items())
        ]
    
    # Évolution combinée des entrées
    evolution_entrees_combinee = combiner_evolutions(evolution_entrees, evolution_depots)
    
    # === STATISTIQUES DES DÉPÔTS === (déplacé avant répartition pour être utilisé)
    # Revenus liés aux dépôts
    depot_stats = Depot.objects.filter(
        date_heure_depôt__date__gte=date_debut,
        date_heure_depôt__date__lte=date_fin
    ).aggregate(
        total_montant=Sum('montant_percu'),
        total_oeufs=Sum('quantite_oeufs'),
        nb_depots=Count('id')
    )
    
    # === RÉPARTITION PAR CATÉGORIE ===
    repartition_entrees = list(transactions.filter(type_transaction='entree').values('categorie').annotate(
        total=Sum('montant'),
        count=Count('id')
    ).order_by('-total'))
    
    # Ajouter les dépôts comme catégorie d'entrée
    if float(depot_entrees) > 0:
        repartition_entrees.insert(0, {
            'categorie': 'depot_client',
            'total': float(depot_entrees),
            'count': depot_stats['nb_depots'] or 0
        })
    
    repartition_sorties = list(transactions.filter(type_transaction='sortie').values('categorie').annotate(
        total=Sum('montant'),
        count=Count('id')
    ).order_by('-total'))
    
    # === TOP CLIENTS (entrées) ===
    top_clients = transactions.filter(
        type_transaction='entree',
        client__isnull=False
    ).values('client__nom', 'client__prenom').annotate(
        total=Sum('montant'),
        count=Count('id')
    ).order_by('-total')[:10]
    
    # === DONNÉES COMPLÈTES ===
    stats = {
        # Synthèse
        'synthese': {
            'total_entrees': float(total_entrees),
            'total_sorties': float(total_sorties),
            'solde': float(solde),
            'nb_entrees': nb_entrees,
            'nb_sorties': nb_sorties,
            'moyenne_entree': float(total_entrees / nb_entrees) if nb_entrees > 0 else 0,
            'moyenne_sortie': float(total_sorties / nb_sorties) if nb_sorties > 0 else 0,
        },
        
        # Évolution temporelle (entrées incluent les dépôts)
        'evolution': {
            'entrees': evolution_entrees_combinee,
            'sorties': format_evolution(evolution_sorties),
        },
        
        # Répartition par catégorie
        'repartition': {
            'entrees': list(repartition_entrees),
            'sorties': list(repartition_sorties),
        },
        
        # Top clients
        'top_clients': list(top_clients),
        
        # Stats des dépôts
        'depots': {
            'total_montant': float(depot_stats['total_montant'] or 0),
            'total_oeufs': depot_stats['total_oeufs'] or 0,
            'nb_depots': depot_stats['nb_depots'] or 0,
        },
        
        # Période analysée
        'periode': {
            'debut': date_debut,
            'fin': date_fin,
            'type': periode,
        }
    }
    
    return Response(stats)


@api_view(['GET'])
def caisse_rapport(request):
    """Génère un rapport fiscal détaillé"""
    from django.db.models.functions import TruncMonth
    from datetime import datetime
    
    # Paramètres
    annee = request.query_params.get('annee', timezone.now().year)
    mois = request.query_params.get('mois')  # Optionnel
    
    # Filtrer par année
    transactions = TransactionCaisse.objects.filter(
        date_transaction__year=annee
    )
    
    if mois:
        transactions = transactions.filter(date_transaction__month=mois)
    
    # Rapport mensuel
    rapport_mensuel = transactions.annotate(
        mois=TruncMonth('date_transaction')
    ).values('mois', 'type_transaction').annotate(
        total=Sum('montant'),
        count=Count('id')
    ).order_by('mois', 'type_transaction')
    
    # Calculer les totaux
    entrees_total = transactions.filter(type_transaction='entree').aggregate(
        total=Sum('montant')
    )['total'] or 0
    
    sorties_total = transactions.filter(type_transaction='sortie').aggregate(
        total=Sum('montant')
    )['total'] or 0
    
    # Répartition par catégorie pour l'année
    categories_entrees = transactions.filter(type_transaction='entree').values('categorie').annotate(
        total=Sum('montant')
    ).order_by('-total')
    
    categories_sorties = transactions.filter(type_transaction='sortie').values('categorie').annotate(
        total=Sum('montant')
    ).order_by('-total')
    
    # Formater le rapport mensuel
    mois_data = {}
    for item in rapport_mensuel:
        mois_key = item['mois'].strftime('%Y-%m') if item['mois'] else 'inconnu'
        if mois_key not in mois_data:
            mois_data[mois_key] = {'entrees': 0, 'sorties': 0, 'entrees_count': 0, 'sorties_count': 0}
        
        if item['type_transaction'] == 'entree':
            mois_data[mois_key]['entrees'] = float(item['total'] or 0)
            mois_data[mois_key]['entrees_count'] = item['count']
        else:
            mois_data[mois_key]['sorties'] = float(item['total'] or 0)
            mois_data[mois_key]['sorties_count'] = item['count']
    
    return Response({
        'annee': int(annee),
        'mois': int(mois) if mois else None,
        'entrees_total': float(entrees_total),
        'sorties_total': float(sorties_total),
        'solde': float(entrees_total - sorties_total),
        'rapport_mensuel': mois_data,
        'categories_entrees': list(categories_entrees),
        'categories_sorties': list(categories_sorties),
    })


# === VUES POUR LES PARAMÈTRES ===

@api_view(['GET'])
def get_parametres(request):
    """Récupère les paramètres de l'application"""
    parametres = Parametre.get_parametres()
    serializer = ParametreSerializer(parametres)
    return Response(serializer.data)


@api_view(['PUT'])
def update_parametres(request):
    """Met à jour les paramètres de l'application"""
    parametres = Parametre.get_parametres()
    serializer = ParametreSerializer(parametres, data=request.data, partial=True)
    
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
def verifier_code_pin(request):
    """Vérifie si le code PIN est correct"""
    code_saisi = request.data.get('code', '')
    
    parametres = Parametre.get_parametres()
    
    # Si le code PIN n'est pas activé, on autorise tout
    if not parametres.code_pin_actif:
        return Response({'valid': True, 'message': 'Code PIN non activé'})
    
    # Vérifier le code
    if parametres.code_pin == code_saisi:
        return Response({'valid': True, 'message': 'Code PIN correct'})
    else:
        return Response({'valid': False, 'message': 'Code PIN incorrect'}, status=status.HTTP_401_UNAUTHORIZED)


@api_view(['POST'])
def changer_code_pin(request):
    """Change le code PIN (nécessite l'ancien code)"""
    ancien_code = request.data.get('ancien_code', '')
    nouveau_code = request.data.get('nouveau_code', '')
    
    parametres = Parametre.get_parametres()
    
    # Vérifier l'ancien code
    if parametres.code_pin_actif and parametres.code_pin != ancien_code:
        return Response({'success': False, 'message': 'Ancien code PIN incorrect'}, status=status.HTTP_401_UNAUTHORIZED)
    
    # Valider le nouveau code
    if not nouveau_code or len(nouveau_code) != 4 or not nouveau_code.isdigit():
        return Response({'success': False, 'message': 'Le nouveau code doit contenir exactement 4 chiffres'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Sauvegarder
    parametres.code_pin = nouveau_code
    parametres.code_pin_actif = True
    parametres.save()
    
    return Response({'success': True, 'message': 'Code PIN modifié avec succès'})


@api_view(['POST'])
def activer_code_pin(request):
    """Active ou désactive le code PIN"""
    activer = request.data.get('activer', True)
    code = request.data.get('code', '')
    
    parametres = Parametre.get_parametres()
    
    if activer:
        # Pour activer, il faut définir un code
        if not code or len(code) != 4 or not code.isdigit():
            return Response({'success': False, 'message': 'Le code doit contenir exactement 4 chiffres'}, status=status.HTTP_400_BAD_REQUEST)
        parametres.code_pin = code
        parametres.code_pin_actif = True
    else:
        # Pour désactiver, il faut le code actuel
        if parametres.code_pin != code:
            return Response({'success': False, 'message': 'Code PIN incorrect'}, status=status.HTTP_401_UNAUTHORIZED)
        parametres.code_pin_actif = False
    
    parametres.save()
    return Response({'success': True, 'message': f'Code PIN {"activé" if activer else "désactivé"}'})


@api_view(['POST'])
@csrf_exempt
def upload_son_alerte(request):
    """Upload un fichier son pour les alertes"""
    type_alerte = request.data.get('type_alerte')  # jour_j, j_1, j_3, perso
    fichier = request.FILES.get('fichier')
    
    if not type_alerte or not fichier:
        return Response({'success': False, 'message': 'Type d\'alerte et fichier requis'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Vérifier le type de fichier
    if not fichier.name.endswith(('.mp3', '.wav', '.ogg')):
        return Response({'success': False, 'message': 'Format de fichier non supporté (mp3, wav, ogg)'}, status=status.HTTP_400_BAD_REQUEST)
    
    # Sauvegarder le fichier
    import os
    from django.conf import settings
    
    # Utiliser STATICFILES_DIRS au lieu de STATIC_ROOT (qui n'est pas défini en dev)
    static_dir = settings.STATICFILES_DIRS[0] if settings.STATICFILES_DIRS else os.path.join(settings.BASE_DIR, 'static')
    audio_dir = os.path.join(static_dir, 'audio')
    os.makedirs(audio_dir, exist_ok=True)
    
    # Nom du fichier selon le type
    nom_fichier = f'alarm_{type_alerte}.mp3'
    chemin_fichier = os.path.join(audio_dir, nom_fichier)
    
    # Sauvegarder
    with open(chemin_fichier, 'wb+') as destination:
        for chunk in fichier.chunks():
            destination.write(chunk)
    
    # Mettre à jour les paramètres
    parametres = Parametre.get_parametres()
    chemin_relatif = f'/static/audio/{nom_fichier}'
    
    if type_alerte == 'jour_j':
        parametres.son_jour_j = chemin_relatif
    elif type_alerte == 'j_1':
        parametres.son_j_1 = chemin_relatif
    elif type_alerte == 'j_3':
        parametres.son_j_3 = chemin_relatif
    elif type_alerte == 'perso':
        parametres.son_perso = chemin_relatif
    
    parametres.save()
    
    return Response({
        'success': True, 
        'message': f'Son {type_alerte} mis à jour',
        'chemin': chemin_relatif
    })
