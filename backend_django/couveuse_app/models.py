from django.db import models
from django.utils import timezone
from datetime import timedelta


class Palette(models.Model):
    """Palette de la couveuse : une palette peut contenir les œufs de plusieurs clients"""
    numero = models.IntegerField(
        unique=True,
        help_text="Numéro unique de la palette"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Palette {self.numero}"

    class Meta:
        verbose_name_plural = "Palettes"
        ordering = ['numero']


class CategorieOeuf(models.Model):
    """Catégorie d'œuf : Poule, Pintade, Oie, Caille, etc."""
    nom = models.CharField(max_length=50, unique=True)
    duree_incubation_jours = models.IntegerField(
        help_text="Nombre de jours pour l'éclosion"
    )
    temperature_recommandee = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        null=True,
        blank=True,
        default=37.50,
        help_text="Température en °C"
    )
    humidite_recommandee = models.IntegerField(
        null=True,
        blank=True,
        default=55,
        help_text="Humidité en %"
    )
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.nom} ({self.duree_incubation_jours} jours)"

    class Meta:
        verbose_name_plural = "Catégories d'œufs"
        ordering = ['nom']


class Race(models.Model):
    """Race/Type spécifique pour chaque catégorie
    Exemple: Koeroler, Goliath, Sasso, Brahama pour les poules
    """
    categorie = models.ForeignKey(
        CategorieOeuf, 
        on_delete=models.CASCADE,
        related_name='races'
    )
    nom = models.CharField(max_length=50)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.categorie.nom} - {self.nom}"

    class Meta:
        verbose_name_plural = "Races"
        ordering = ['categorie', 'nom']
        unique_together = ['categorie', 'nom']


class Client(models.Model):
    """Client qui dépose les œufs à la couveuse"""
    nom = models.CharField(max_length=100)
    prenom = models.CharField(max_length=100, blank=True)
    telephone = models.CharField(max_length=20)
    telephone_2 = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    adresse = models.TextField(blank=True)
    date_inscription = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)
    est_actif = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.nom} {self.prenom} ({self.telephone})"

    class Meta:
        ordering = ['nom']


class Depot(models.Model):
    """Dépôt d'œufs par un client"""
    STATUT_CHOICES = [
        ('en_cours', 'En incubation'),
        ('eclos', 'Éclos'),
        ('echec', 'Échec'),
        ('annule', 'Annulé'),
    ]

    client = models.ForeignKey(
        Client,
        on_delete=models.CASCADE,
        related_name='depots'
    )
    race = models.ForeignKey(
        Race,
        on_delete=models.CASCADE,
        related_name='depots'
    )
    palette = models.ForeignKey(
        Palette,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='depots'
    )
    date_heure_depôt = models.DateTimeField(
        default=timezone.now,
        verbose_name="Date et heure du dépôt"
    )
    quantite_oeufs = models.IntegerField(default=0)
    quantite_eclos = models.IntegerField(default=0)
    montant_percu = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
        help_text="Montant payé par le client"
    )
    prix_unitaire = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        default=0,
        help_text="Prix par œuf"
    )
    statut = models.CharField(
        max_length=20,
        choices=STATUT_CHOICES,
        default='en_cours'
    )
    date_eclosion_prevue = models.DateField(null=True, blank=True)
    remarque = models.TextField(
        blank=True,
        help_text="Remarques sur les œufs ou le dépôt"
    )

    # Alertes personnalisées
    alerte_perso_active = models.BooleanField(
        default=False,
        verbose_name="Alerte personnalisée active"
    )
    alerte_perso_date = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Date et heure de l'alerte personnalisée"
    )
    alerte_perso_message = models.CharField(
        max_length=200,
        blank=True,
        default='',
        verbose_name="Message de l'alerte personnalisée"
    )

    created_at = models.DateTimeField(auto_now_add=True)

    def clean(self):
        """Validation personnalisée"""
        from django.core.exceptions import ValidationError
        if self.alerte_perso_active and not self.alerte_perso_date:
            raise ValidationError({
                'alerte_perso_date': 'La date est obligatoire si l\'alerte personnalisée est active'
            })
        # Vérifier que la date d'alerte est avant l'éclosion
        if self.alerte_perso_active and self.alerte_perso_date and self.date_eclosion_prevue:
            from django.utils import timezone
            # Comparer avec la date d'éclosion à 23:59:59 pour permettre les alertes le jour même
            date_eclosion_fin = timezone.make_aware(
                timezone.datetime.combine(self.date_eclosion_prevue, timezone.datetime.max.time())
            )
            if self.alerte_perso_date >= date_eclosion_fin:
                raise ValidationError({
                    'alerte_perso_date': 'La date d\'alerte doit être avant la fin de la date d\'éclosion'
                })

    def save(self, *args, **kwargs):
        # Calcul automatique de la date d'éclosion SI elle n'existe pas
        should_recalc = False
        if self.date_heure_depôt and self.race_id:
            if not self.date_eclosion_prevue:
                should_recalc = True
            elif self.pk:
                try:
                    old = Depot.objects.select_related('race__categorie').get(pk=self.pk)
                    old_expected = None
                    if old.date_heure_depôt and old.race and old.race.categorie:
                        old_expected = old.date_heure_depôt.date() + timedelta(days=old.race.categorie.duree_incubation_jours)

                    changed_date = old.date_heure_depôt != self.date_heure_depôt
                    changed_race = old.race_id != self.race_id
                    if (changed_date or changed_race) and self.date_eclosion_prevue == old_expected:
                        should_recalc = True
                except Depot.DoesNotExist:
                    should_recalc = True

        if should_recalc:
            # S'assurer que la race est chargée
            if hasattr(self.race, 'categorie') and self.race.categorie:
                self.date_eclosion_prevue = (
                    self.date_heure_depôt.date() +
                    timedelta(days=self.race.categorie.duree_incubation_jours)
                )
            else:
                from .models import Race
                race = Race.objects.select_related('categorie').get(id=self.race_id)
                self.date_eclosion_prevue = (
                    self.date_heure_depôt.date() +
                    timedelta(days=race.categorie.duree_incubation_jours)
                )

        # Calcul automatique du montant si prix unitaire défini
        if self.prix_unitaire and not self.montant_percu:
            self.montant_percu = self.prix_unitaire * self.quantite_oeufs

        super().save(*args, **kwargs)

    def jours_restants(self):
        """Calcule les jours restants avant éclosion"""
        if self.date_eclosion_prevue:
            return (self.date_eclosion_prevue - timezone.now().date()).days
        return None

    def __str__(self):
        return f"Dépôt de {self.client.nom} - {self.race} ({self.quantite_oeufs} œufs)"

    class Meta:
        verbose_name_plural = "Dépôts"
        ordering = ['-date_heure_depôt']


class Alerte(models.Model):
    """Alertes et notifications pour les dépôts"""
    TYPE_ALERTES = [
        ('j_7', 'J-7'),
        ('j_3', 'J-3'),
        ('j_1', 'J-1'),
        ('jour_j', 'Jour J'),
        ('retard', 'Retard'),
    ]

    depot = models.ForeignKey(Depot, on_delete=models.CASCADE)
    type_alerte = models.CharField(max_length=10, choices=TYPE_ALERTES)
    message = models.TextField()
    date_prevue = models.DateTimeField()
    date_envoyee = models.DateTimeField(null=True, blank=True)
    est_lue = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"[{self.get_type_alerte_display()}] {self.depot}"

    class Meta:
        ordering = ['-date_prevue']


class Parametre(models.Model):
    """Paramètres de l'application - Singleton"""
    
    # Informations de l'entreprise
    nom_entreprise = models.CharField(
        max_length=100, 
        default="Ma Couveuse",
        blank=True,
        verbose_name="Nom de l'entreprise"
    )
    adresse_entreprise = models.TextField(
        blank=True,
        verbose_name="Adresse"
    )
    telephone_entreprise = models.CharField(
        max_length=20, 
        blank=True,
        verbose_name="Téléphone"
    )
    email_entreprise = models.EmailField(
        blank=True,
        verbose_name="Email"
    )
    
    # Sécurité
    code_pin = models.CharField(
        max_length=4, 
        blank=True,
        verbose_name="Code PIN (4 chiffres)",
        help_text="Code pour protéger les actions sensibles"
    )
    code_pin_actif = models.BooleanField(
        default=False,
        verbose_name="Activer le code PIN"
    )
    
    # Sons d'alerte (chemins vers fichiers MP3)
    son_jour_j = models.CharField(
        max_length=255,
        blank=True,
        default="/static/audio/alarm_critical.mp3",
        verbose_name="Son Jour J (éclosion)"
    )
    son_j_1 = models.CharField(
        max_length=255,
        blank=True,
        default="/static/audio/alarm_warning.mp3",
        verbose_name="Son J-1"
    )
    son_j_3 = models.CharField(
        max_length=255,
        blank=True,
        default="/static/audio/alarm_info.mp3",
        verbose_name="Son J-3"
    )
    son_perso = models.CharField(
        max_length=255,
        blank=True,
        default="/static/audio/alarm_perso.mp3",
        verbose_name="Son alerte personnalisée"
    )
    
    # Notifications
    notifications_actives = models.BooleanField(
        default=True,
        verbose_name="Notifications navigateur"
    )
    son_actif = models.BooleanField(
        default=True,
        verbose_name="Sons d'alerte"
    )
    repetition_alarme = models.IntegerField(
        default=3,
        verbose_name="Nombre de répétitions d'alarme"
    )
    
    # Paramètres d'incubation par défaut
    temperature_defaut = models.DecimalField(
        max_digits=4, 
        decimal_places=2, 
        default=37.50,
        verbose_name="Température par défaut (°C)"
    )
    humidite_defaut = models.IntegerField(
        default=55,
        verbose_name="Humidité par défaut (%)"
    )
    
    # Paramètres d'affichage
    theme = models.CharField(
        max_length=20, 
        default="light",
        verbose_name="Thème"
    )
    langue = models.CharField(
        max_length=5, 
        default="fr",
        verbose_name="Langue"
    )
    
    # Sauvegarde
    sauvegarde_auto = models.BooleanField(
        default=True,
        verbose_name="Sauvegarde automatique"
    )
    frequence_sauvegarde = models.IntegerField(
        default=7,
        verbose_name="Fréquence de sauvegarde (jours)"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"Paramètres - {self.nom_entreprise}"
    
    @classmethod
    def get_parametres(cls):
        """Récupère l'instance unique des paramètres"""
        param, _ = cls.objects.get_or_create(pk=1)
        return param
    
    def save(self, *args, **kwargs):
        # Forcer l'ID à 1 pour le singleton
        self.pk = 1
        super().save(*args, **kwargs)
    
    class Meta:
        verbose_name = "Paramètre"
        verbose_name_plural = "Paramètres"


class TransactionCaisse(models.Model):
    """Transactions de caisse - Entrées et Sorties d'argent"""
    TYPE_CHOICES = [
        ('entree', 'Entrée'),
        ('sortie', 'Sortie'),
    ]
    
    CATEGORIE_CHOICES = [
        # Entrées
        ('depot_client', 'Dépôt client'),
        ('eclosion', 'Éclosion payée'),
        ('autre_entree', 'Autre entrée'),
        # Sorties
        ('achat_materiel', 'Achat matériel'),
        ('electricite', 'Électricité'),
        ('eau', 'Eau'),
        ('salaire', 'Salaire'),
        ('maintenance', 'Maintenance'),
        ('transport', 'Transport'),
        ('autre_sortie', 'Autre sortie'),
    ]
    
    type_transaction = models.CharField(
        max_length=10, 
        choices=TYPE_CHOICES,
        help_text="Type: Entrée ou Sortie"
    )
    categorie = models.CharField(
        max_length=30,
        choices=CATEGORIE_CHOICES,
        help_text="Catégorie de la transaction"
    )
    montant = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="Montant en FCFA"
    )
    description = models.TextField(
        blank=True,
        help_text="Description détaillée"
    )
    depot = models.ForeignKey(
        Depot,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transactions',
        help_text="Dépôt associé (si applicable)"
    )
    client = models.ForeignKey(
        Client,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transactions',
        help_text="Client associé (si applicable)"
    )
    date_transaction = models.DateField(
        default=timezone.now,
        help_text="Date de la transaction"
    )
    reference = models.CharField(
        max_length=100,
        blank=True,
        help_text="Référence ou numéro de reçu"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.CharField(max_length=100, blank=True)
    
    def __str__(self):
        return f"[{self.get_type_transaction_display()}] {self.montant} FCFA - {self.get_categorie_display()}"
    
    class Meta:
        verbose_name = "Transaction de caisse"
        verbose_name_plural = "Transactions de caisse"
        ordering = ['-date_transaction', '-created_at']
