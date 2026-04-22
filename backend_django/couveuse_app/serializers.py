from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from django.utils import timezone
from datetime import timedelta
from django.db.models import Sum
from .models import CategorieOeuf, Race, Client, Depot, Alerte, Palette, TransactionCaisse, Parametre


class PaletteSerializer(serializers.ModelSerializer):
    # Compter tous les dépôts sur cette palette
    total_depots = serializers.SerializerMethodField()
    # Compter les dépôts en cours sur cette palette
    depots_en_cours = serializers.SerializerMethodField()
    # Compter le nombre total d'œufs sur cette palette
    total_oeufs = serializers.SerializerMethodField()
    # Lister TOUS les clients sur cette palette
    clients_sur_palette = serializers.SerializerMethodField()

    class Meta:
        model = Palette
        fields = ['id', 'numero', 'created_at', 'total_depots', 'depots_en_cours', 'total_oeufs', 'clients_sur_palette']

    def get_total_depots(self, obj):
        return obj.depots.count()

    def get_depots_en_cours(self, obj):
        return obj.depots.filter(statut='en_cours').count()

    def get_total_oeufs(self, obj):
        return obj.depots.filter(statut='en_cours').aggregate(
            total=Sum('quantite_oeufs')
        )['total'] or 0

    def get_clients_sur_palette(self, obj):
        # Inclure TOUS les dépôts, pas seulement en_cours
        depots = obj.depots.select_related('client', 'race')
        return [
            {
                'id': d.id,
                'client_nom': d.client.nom,
                'client_prenom': d.client.prenom,
                'race_nom': d.race.nom,
                'categorie_nom': d.race.categorie.nom,
                'quantite_oeufs': d.quantite_oeufs,
                'date_eclosion_prevue': str(d.date_eclosion_prevue) if d.date_eclosion_prevue else None,
                'statut': d.statut
            }
            for d in depots
        ]


class CategorieOeufSerializer(serializers.ModelSerializer):
    class Meta:
        model = CategorieOeuf
        fields = '__all__'


class RaceSerializer(serializers.ModelSerializer):
    categorie_nom = serializers.CharField(source='categorie.nom', read_only=True)

    class Meta:
        model = Race
        fields = '__all__'


class ClientSerializer(serializers.ModelSerializer):
    nb_depots = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = '__all__'
        extra_kwargs = {
            'telegram_chat_id': {'required': False, 'allow_blank': True}
        }

    def get_nb_depots(self, obj):
        return obj.depots.count()


class DepotSerializer(serializers.ModelSerializer):
    client_nom = serializers.CharField(source='client.nom', read_only=True)
    client_prenom = serializers.CharField(source='client.prenom', read_only=True)
    race_nom = serializers.CharField(source='race.nom', read_only=True)
    categorie_nom = serializers.CharField(source='race.categorie.nom', read_only=True)
    palette_numero = serializers.IntegerField(source='palette.numero', read_only=True)
    jours_restants = serializers.SerializerMethodField()

    class Meta:
        model = Depot
        fields = '__all__'
        extra_kwargs = {
            'alerte_perso_active': {'required': False},
            'alerte_perso_date': {'required': False, 'allow_null': True},
            'alerte_perso_message': {'required': False, 'allow_blank': True},
        }

    def get_jours_restants(self, obj):
        # Calculer les jours restants dynamiquement
        if obj.date_eclosion_prevue:
            from datetime import date
            return (obj.date_eclosion_prevue - date.today()).days
        return None
    
    def create(self, validated_data):
        # Créer le dépôt et calculer manuellement date_eclosion_prevue
        race = validated_data.get('race')
        date_heure_depôt = validated_data.get('date_heure_depôt', timezone.now())
        
        depot = super().create(validated_data)
        
        # Calculer et sauvegarder date_eclosion_prevue
        if race and hasattr(race, 'categorie'):
            depot.date_eclosion_prevue = date_heure_depôt.date() + timedelta(
                days=race.categorie.duree_incubation_jours
            )
            depot.save(update_fields=['date_eclosion_prevue'])
        
        return depot
    
    def update(self, instance, validated_data):
        """Gère la mise à jour des alertes personnalisées"""
        # Capturer les anciennes valeurs AVANT la mise à jour
        ancienne_date = instance.alerte_perso_date
        ancien_active = instance.alerte_perso_active
        ancienne_date_depot = instance.date_heure_depôt
        ancien_race_id = instance.race_id
        
        # Appliquer les changements via la méthode parent
        instance = super().update(instance, validated_data)

        # Recalculer la date d'éclosion si la date du dépôt ou la race change
        if ('date_heure_depôt' in validated_data or 'race' in validated_data or 'race_id' in validated_data) and not validated_data.get('date_eclosion_prevue'):
            if instance.date_heure_depôt and instance.race and hasattr(instance.race, 'categorie'):
                instance.date_eclosion_prevue = (
                    instance.date_heure_depôt.date() +
                    timedelta(days=instance.race.categorie.duree_incubation_jours)
                )
                instance.save(update_fields=['date_eclosion_prevue'])

        # Si l'alerte est active et que la date a changé (ou vient d'être activée),
        # supprimer les anciennes alertes perso de ce dépôt pour permettre
        # au notifier de recréer la nouvelle alerte
        if instance.alerte_perso_active and instance.alerte_perso_date:
            date_changed = (ancienne_date != instance.alerte_perso_date)
            just_activated = (not ancien_active and instance.alerte_perso_active)
            
            if date_changed or just_activated:
                # Supprimer les anciennes alertes perso pour ce dépôt
                Alerte.objects.filter(depot=instance, type_alerte='perso').delete()
                print(f"🗑️ Anciennes alertes perso supprimées pour le dépôt {instance.id}")

        return instance


class AlerteSerializer(serializers.ModelSerializer):
    depot_client_nom = serializers.CharField(source='depot.client.nom', read_only=True)
    depot_race_nom = serializers.CharField(source='depot.race.nom', read_only=True)

    class Meta:
        model = Alerte
        fields = '__all__'


class TransactionCaisseSerializer(serializers.ModelSerializer):
    client_nom = serializers.CharField(source='client.nom', read_only=True)
    depot_info = serializers.SerializerMethodField()
    type_display = serializers.CharField(source='get_type_transaction_display', read_only=True)
    categorie_display = serializers.CharField(source='get_categorie_display', read_only=True)
    
    class Meta:
        model = TransactionCaisse
        fields = '__all__'
    
    def get_depot_info(self, obj):
        if obj.depot:
            return f"{obj.depot.client.nom} - {obj.depot.quantite_oeufs} œufs"
        return None


class ParametreSerializer(serializers.ModelSerializer):
    """Serializer pour les paramètres de l'application"""
    
    # Champ calculé pour les sons (format JSON attendu par le frontend)
    sons = serializers.SerializerMethodField()
    
    class Meta:
        model = Parametre
        exclude = ['created_at', 'updated_at']
        extra_kwargs = {
            'code_pin': {'required': False, 'allow_blank': True, 'write_only': True},
            'nom_entreprise': {'required': False, 'allow_blank': True},
            'adresse_entreprise': {'required': False, 'allow_blank': True},
            'telephone_entreprise': {'required': False, 'allow_blank': True},
            'email_entreprise': {'required': False, 'allow_blank': True},
            'son_jour_j': {'required': False, 'allow_blank': True},
            'son_j_1': {'required': False, 'allow_blank': True},
            'son_j_3': {'required': False, 'allow_blank': True},
            'son_perso': {'required': False, 'allow_blank': True},
            # code_pin_actif DOIT être lisible par le frontend
        }
    
    def get_sons(self, obj):
        """Retourne les sons sous forme de dictionnaire"""
        return {
            'jour_j': obj.son_jour_j or '/static/audio/alarm.mp3',
            'j_1': obj.son_j_1 or '/static/audio/alarm.mp3',
            'j_3': obj.son_j_3 or '/static/audio/alarm.mp3',
            'perso': obj.son_perso or '/static/audio/alarm.mp3',
        }
    
    def validate_nom_entreprise(self, value):
        """Valeur par défaut si vide"""
        return value if value else 'Ma Couveuse'
    
    def validate_code_pin(self, value):
        """Valider que le code PIN contient exactement 4 chiffres"""
        # Si value est vide ou None, c'est OK
        if not value:
            return value
        # Si value existe, il doit avoir exactement 4 chiffres
        if not value.isdigit() or len(value) != 4:
            raise serializers.ValidationError("Le code PIN doit contenir exactement 4 chiffres")
        return value
    
    def update(self, instance, validated_data):
        """Gérer les mises à jour partielles avec valeurs par défaut"""
        # S'assurer que nom_entreprise n'est jamais vide
        if 'nom_entreprise' in validated_data and not validated_data['nom_entreprise']:
            validated_data['nom_entreprise'] = 'Ma Couveuse'
        return super().update(instance, validated_data)
