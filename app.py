import pandas as pd
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import os
import re
import jellyfish  # Pour les algorithmes de similarité textuelle avancés
from rapidfuzz import fuzz, process  # Pour la recherche floue
import json

app = Flask(__name__)
CORS(app)

# Charger et prétraiter les données avec améliorations
def load_and_preprocess_data():
    try:
        # Chemin vers le fichier Excel
        excel_path = os.path.join('data', 'BAI.xlsx')
        
        # Charger les données avec gestion des en-têtes
        df = pd.read_excel(excel_path, sheet_name='DB', header=1)

        # Nettoyer les noms de colonnes
        df.columns = df.columns.str.strip()

        # Supprimer les colonnes inutiles
        if 'Unnamed: 0' in df.columns:
            df = df.drop('Unnamed: 0', axis=1)
        
        # S'assurer que toutes les colonnes sont de type string pour la recherche
        df = df.astype(str)
        
        # Créer plusieurs colonnes de texte combinées pour différents types de recherche
        df['search_text_complete'] = df.apply(
            lambda row: f"{row.get('Code', '')} {row.get('Reference', '')} {row.get('Designation', '')}",
            axis=1
        )
        
        df['search_text_names'] = df.apply(
            lambda row: f"{row.get('Designation', '')} {row.get('Reference', '')}",
            axis=1
        )
        
        df['search_text_codes'] = df.apply(
            lambda row: f"{row.get('Code', '')} {row.get('Reference', '')}",
            axis=1
        )
        
        # Nettoyer le texte pour la recherche
        for col in ['search_text_complete', 'search_text_names', 'search_text_codes']:
            df[f'{col}_clean'] = df[col].apply(
                lambda x: re.sub(r'[^\w\s]', ' ', str(x).lower()).strip()
            )
        
        # Créer un index de recherche rapide pour les codes et références
        df['code_lower'] = df['Code'].str.lower()
        df['reference_lower'] = df['Reference'].str.lower()
        df['designation_lower'] = df['Designation'].str.lower()
        
        return df
    except Exception as e:
        print(f"Erreur lors du chargement des données: {e}")
        # Créer un DataFrame minimal en cas d'erreur
        return pd.DataFrame()

# Initialiser les données et vectoriseurs
df = load_and_preprocess_data()

# Initialiser plusieurs vectoriseurs TF-IDF pour différents types de recherche
vectorizer_complete = TfidfVectorizer(
    stop_words=None, 
    min_df=1, 
    max_df=0.85,
    ngram_range=(1, 3),  # Utiliser des n-grammes pour capturer les termes composés
    analyzer='char_wb'  # Analyser par caractères avec limites de mots
)

vectorizer_names = TfidfVectorizer(
    stop_words=None,
    min_df=1,
    max_df=0.9,
    ngram_range=(1, 2)
)

# Entraîner les vectoriseurs
if not df.empty:
    tfidf_complete = vectorizer_complete.fit_transform(df['search_text_complete_clean'])
    tfidf_names = vectorizer_names.fit_transform(df['search_text_names_clean'])
else:
    tfidf_complete = None
    tfidf_names = None

# Fonction de recherche par similarité améliorée avec plusieurs algorithmes
def enhanced_search_by_similarity(query, top_n=10):
    if df.empty or tfidf_complete is None:
        return []
    
    results = []
    query_clean = re.sub(r'[^\w\s]', ' ', query.lower()).strip()
    
    # 1. Recherche par similarité cosinus avec TF-IDF
    try:
        query_vec_complete = vectorizer_complete.transform([query_clean])
        similarities_complete = cosine_similarity(query_vec_complete, tfidf_complete).flatten()
        
        # 2. Recherche par similarité avec noms
        query_vec_names = vectorizer_names.transform([query_clean])
        similarities_names = cosine_similarity(query_vec_names, tfidf_names).flatten()
        
        # Combiner les similarités avec pondération
        combined_similarities = (similarities_complete * 0.6 + similarities_names * 0.4)
        
        # Obtenir les indices triés
        sorted_indices = np.argsort(combined_similarities)[::-1]
        
        for idx in sorted_indices[:top_n]:
            if combined_similarities[idx] > 0.001:  # Seuil réduit pour plus de résultats
                row = df.iloc[idx]
                
                # 3. Vérifier la similarité textuelle avec Jaro-Winkler pour les codes
                code_similarity = jellyfish.jaro_winkler_similarity(
                    str(row['Code']).lower(),
                    query_clean
                )
                
                # 4. Vérifier la similarité avec la désignation
                designation_similarity = jellyfish.jaro_winkler_similarity(
                    str(row['Designation']).lower(),
                    query_clean
                )
                
                # Calculer le score final combiné
                final_score = max(
                    combined_similarities[idx],
                    code_similarity,
                    designation_similarity
                )
                
                if final_score > 0.01:  # Seuil final
                    results.append({
                        'Code': str(row.get('Code', '')),
                        'Reference': str(row.get('Reference', '')),
                        'Designation': str(row.get('Designation', '')),
                        'Prix_Gros': str(row.get('Prix Gros', '')),
                        'Prix_Detail': str(row.get('Prix Detail', '')),
                        'Remise': str(row.get('Remise', '')),
                        'Stock': str(row.get('Stock', '')),
                        'Similarity': float(final_score)
                    })
    except Exception as e:
        print(f"Erreur dans la recherche par similarité: {e}")
    
    return results

# Fonction de recherche exacte améliorée
def enhanced_search_exact(query):
    if df.empty:
        return []
    
    results = []
    query_lower = query.lower().strip()
    
    # Recherche exacte dans tous les champs
    for _, row in df.iterrows():
        match_found = False
        
        # Vérifier correspondance exacte (insensible à la casse)
        if query_lower == str(row['code_lower']).strip():
            match_found = True
        elif query_lower == str(row['reference_lower']).strip():
            match_found = True
        elif query_lower == str(row['designation_lower']).strip():
            match_found = True
        # Vérifier si le terme fait partie d'un champ
        elif query_lower in str(row['code_lower']):
            match_found = True
        elif query_lower in str(row['reference_lower']):
            match_found = True
        elif query_lower in str(row['designation_lower']):
            match_found = True
        
        if match_found:
            results.append({
                'Code': str(row.get('Code', '')),
                'Reference': str(row.get('Reference', '')),
                'Designation': str(row.get('Designation', '')),
                'Prix_Gros': str(row.get('Prix Gros', '')),
                'Prix_Detail': str(row.get('Prix Detail', '')),
                'Remise': str(row.get('Remise', '')),
                'Stock': str(row.get('Stock', '')),
                'Similarity': 1.0
            })
    
    return results

# Recherche par stock
def search_by_stock(query):
    if df.empty:
        return []
    
    results = []
    
    # Essayer d'extraire un nombre de la requête
    import re
    stock_numbers = re.findall(r'\d+', query)
    
    if stock_numbers:
        try:
            target_stock = int(stock_numbers[0])
            # Filtrer les articles avec un stock proche du nombre recherché
            for _, row in df.iterrows():
                try:
                    stock_value = int(row.get('Stock', 0))
                    if stock_value >= target_stock:
                        results.append({
                            'Code': str(row.get('Code', '')),
                            'Reference': str(row.get('Reference', '')),
                            'Designation': str(row.get('Designation', '')),
                            'Prix_Gros': str(row.get('Prix Gros', '')),
                            'Prix_Detail': str(row.get('Prix Detail', '')),
                            'Remise': str(row.get('Remise', '')),
                            'Stock': str(row.get('Stock', '')),
                            'Similarity': min(stock_value / (target_stock * 1.5), 1.0)
                        })
                except ValueError:
                    continue
        except ValueError:
            pass
    
    return results

# Routes API améliorées
@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/search', methods=['POST'])
def search():
    try:
        data = request.json
        query = data.get('query', '').strip()
        
        if not query:
            return jsonify({
                'results': [],
                'search_type': 'erreur',
                'message': 'Veuillez entrer une requête valide'
            })
        
        # Détecter le type de recherche
        query_lower = query.lower()
        
        # Recherche de stock
        if 'stock' in query_lower or 'dispon' in query_lower:
            stock_results = search_by_stock(query)
            if stock_results:
                stock_results.sort(key=lambda x: int(x['Stock']), reverse=True)
                return jsonify({
                    'results': stock_results[:10],
                    'search_type': 'stock',
                    'message': f'J\'ai trouvé {len(stock_results)} articles correspondant à votre recherche de stock'
                })
        
        # Recherche exacte d'abord
        exact_results = enhanced_search_exact(query)
        
        if exact_results:
            return jsonify({
                'results': exact_results[:10],
                'search_type': 'exacte',
                'message': f'J\'ai trouvé {len(exact_results)} résultat(s) exact(s)'
            })
        
        # Recherche par similarité
        similar_results = enhanced_search_by_similarity(query, top_n=15)
        
        if similar_results:
            # Trier par similarité
            similar_results.sort(key=lambda x: x['Similarity'], reverse=True)
            
            # Filtrer les doublons basés sur le code
            unique_results = []
            seen_codes = set()
            for result in similar_results:
                if result['Code'] not in seen_codes:
                    seen_codes.add(result['Code'])
                    unique_results.append(result)
            
            return jsonify({
                'results': unique_results[:10],
                'search_type': 'similarité',
                'message': f'Voici {len(unique_results)} résultat(s) pertinents pour "{query}"'
            })
        else:
            # Recherche plus large
            broad_results = []
            if not df.empty:
                for _, row in df.iterrows():
                    # Vérifier si la requête apparaît dans n'importe quel champ
                    all_text = f"{row.get('Code', '')} {row.get('Reference', '')} {row.get('Designation', '')}".lower()
                    if query_lower in all_text:
                        broad_results.append({
                            'Code': str(row.get('Code', '')),
                            'Reference': str(row.get('Reference', '')),
                            'Designation': str(row.get('Designation', '')),
                            'Prix_Gros': str(row.get('Prix Gros', '')),
                            'Prix_Detail': str(row.get('Prix Detail', '')),
                            'Remise': str(row.get('Remise', '')),
                            'Stock': str(row.get('Stock', '')),
                            'Similarity': 0.1
                        })
            
            if broad_results:
                return jsonify({
                    'results': broad_results[:5],
                    'search_type': 'large',
                    'message': f'Voici {len(broad_results)} résultat(s) contenant "{query}"'
                })
            else:
                return jsonify({
                    'results': [],
                    'search_type': 'aucun',
                    'message': f'Je n\'ai pas trouvé de résultats pour "{query}". Essayez avec un code, une référence ou un nom différent.'
                })
    
    except Exception as e:
        print(f"Erreur dans /api/search: {e}")
        return jsonify({
            'results': [],
            'search_type': 'erreur',
            'message': 'Une erreur est survenue lors de la recherche'
        })

@app.route('/api/stats', methods=['GET'])
def get_stats():
    try:
        if df.empty:
            return jsonify({
                'total_items': 0,
                'total_stock': 0,
                'avg_price': 0
            })
        
        total_items = len(df)
        
        # Calculer le stock total
        try:
            total_stock = pd.to_numeric(df['Stock'], errors='coerce').sum()
            total_stock = int(total_stock) if not pd.isna(total_stock) else 0
        except:
            total_stock = 0
        
        # Calculer le prix moyen
        try:
            avg_price = pd.to_numeric(df['Prix Detail'], errors='coerce').mean()
            avg_price = round(float(avg_price), 2) if not pd.isna(avg_price) else 0
        except:
            avg_price = 0
        
        return jsonify({
            'total_items': total_items,
            'total_stock': total_stock,
            'avg_price': avg_price
        })
    except Exception as e:
        print(f"Erreur dans /api/stats: {e}")
        return jsonify({
            'total_items': 0,
            'total_stock': 0,
            'avg_price': 0
        })

@app.route('/api/suggestions', methods=['GET'])
def get_suggestions():
    """Retourne des suggestions de recherche"""
    try:
        if df.empty:
            return jsonify({'suggestions': []})
        
        # Extraire quelques exemples pour les suggestions
        suggestions = []
        
        # Codes
        codes = df['Code'].head(5).tolist()
        suggestions.extend([f"Code: {code}" for code in codes])
        
        # Désignations
        designations = df['Designation'].head(3).tolist()
        suggestions.extend([f"Article: {designation}" for designation in designations])
        
        # Références
        references = df['Reference'].head(3).tolist()
        suggestions.extend([f"Référence: {ref}" for ref in references])
        
        return jsonify({'suggestions': suggestions})
    except Exception as e:
        print(f"Erreur dans /api/suggestions: {e}")
        return jsonify({'suggestions': []})

if __name__ == '__main__':
    # Vérifier que les données sont chargées
    if not df.empty:
        print(f"✅ Données chargées avec succès: {len(df)} articles")
        print(f"📊 Stock total: {pd.to_numeric(df['Stock'], errors='coerce').sum()}")
        print("🚀 Serveur prêt à recevoir des requêtes...")
    else:
        print("⚠️ Aucune donnée chargée. Vérifiez le fichier Excel.")
    
    app.run(debug=True, port=5000, host='0.0.0.0')