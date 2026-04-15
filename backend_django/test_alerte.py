import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'couveuse_project.settings')
django.setup()

from couveuse_app.models import Depot

# Vérifier les champs d'alerte personnalisée
depots = Depot.objects.all()[:5]
for d in depots:
    print(f"Dépôt #{d.id}: alerte_active={d.alerte_perso_active}, alerte_date={d.alerte_perso_date}, alerte_message={d.alerte_perso_message}")

# Essayer de modifier un dépôt
if depots:
    d = depots[0]
    print(f"\nTest modification dépôt #{d.id}")
    d.alerte_perso_active = True
    d.alerte_perso_message = "Test message"
    d.save()
    print(f"Après save: alerte_active={d.alerte_perso_active}, alerte_message={d.alerte_perso_message}")