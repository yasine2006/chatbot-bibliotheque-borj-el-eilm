document.addEventListener('DOMContentLoaded', function() {
    // Éléments DOM
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const voiceInputButton = document.getElementById('voice-input-button');
    const resultsBody = document.getElementById('results-body');
    const searchInfo = document.getElementById('search-info');
    const totalItemsEl = document.getElementById('total-items');
    const totalStockEl = document.getElementById('total-stock');
    const quickButtons = document.querySelectorAll('.quick-btn');
    const themeToggle = document.getElementById('theme-toggle');

    // Variables pour la reconnaissance vocale
    let recognition = null;
    let isListening = false;
    let silenceTimer = null;

    // Variables pour la synthèse vocale
    let speechSynthesis = window.speechSynthesis;
    let isSpeaking = false;
    let voiceOutputEnabled = false;
    let currentVoice = null;

    // Variables pour l'autocomplétion
    let suggestions = [];
    let suggestionIndex = -1;

    // URL de l'API backend
    const API_BASE_URL = window.location.origin;
    
    // Charger les statistiques et suggestions au démarrage
    loadStats();
    loadSuggestions();
    
    // Initialiser la reconnaissance vocale
    initSpeechRecognition();
    
    // Initialiser la synthèse vocale
    initSpeechSynthesis();
    
    // Événement pour envoyer un message
    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    // Autocomplétion avec flèches
    userInput.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            navigateSuggestions(e.key === 'ArrowDown');
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            if (suggestionIndex >= 0 && suggestions[suggestionIndex]) {
                userInput.value = suggestions[suggestionIndex].replace('Code: ', '').replace('Article: ', '').replace('Référence: ', '');
                suggestionIndex = -1;
            }
        }
    });

    // Événements pour les boutons rapides
    quickButtons.forEach(button => {
        button.addEventListener('click', function() {
            const query = this.getAttribute('data-query');
            userInput.value = query;
            sendMessage();
        });
    });

    // Événement pour le bouton de contrôle de la voix
    const voiceOutputToggle = document.getElementById('voice-output-toggle');
    voiceOutputToggle.addEventListener('click', toggleVoiceOutput);

    // Événement pour le bouton de saisie vocale
    voiceInputButton.addEventListener('click', toggleVoiceInput);

    // Événement pour le changement de thème
    themeToggle.addEventListener('click', toggleTheme);

    // Initialiser la reconnaissance vocale
    function initSpeechRecognition() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            recognition = new SpeechRecognition();
            
            // Configuration optimisée
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = 'fr-FR';
            recognition.maxAlternatives = 3;
            
            recognition.onstart = function() {
                isListening = true;
                voiceInputButton.classList.add('listening');
                voiceInputButton.innerHTML = '<i class="fas fa-microphone-slash"></i>';
                voiceInputButton.title = 'Arrêter l\'écoute';
                addBotMessage('🎤 Je vous écoute... Parlez maintenant.');
                
                // Démarrer un timer pour détecter le silence
                silenceTimer = setTimeout(() => {
                    if (isListening) {
                        recognition.stop();
                        addBotMessage('⏱️ Temps d\'écoute écoulé. Je stoppe l\'écoute.');
                    }
                }, 10000); // 10 secondes de timeout
            };

            recognition.onresult = function(event) {
                clearTimeout(silenceTimer);
                
                let finalTranscript = '';
                let interimTranscript = '';
                
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }
                
                // Mettre à jour le champ avec la transcription finale ou intermédiaire
                if (finalTranscript) {
                    userInput.value = finalTranscript;
                    addBotMessage(`🗣️ Vous avez dit: "${finalTranscript}"`);
                    setTimeout(() => sendMessage(), 500);
                } else if (interimTranscript) {
                    userInput.value = interimTranscript;
                }
            };

            recognition.onend = function() {
                isListening = false;
                voiceInputButton.classList.remove('listening');
                voiceInputButton.innerHTML = '<i class="fas fa-microphone"></i>';
                voiceInputButton.title = 'Parler';
                clearTimeout(silenceTimer);
            };

            recognition.onerror = function(event) {
                console.error('Erreur de reconnaissance vocale:', event.error);
                let errorMessage = 'Erreur de reconnaissance vocale. ';
                
                switch(event.error) {
                    case 'no-speech':
                        errorMessage += 'Aucune parole détectée.';
                        break;
                    case 'audio-capture':
                        errorMessage += 'Problème avec le microphone.';
                        break;
                    case 'not-allowed':
                        errorMessage += 'Microphone non autorisé.';
                        break;
                    default:
                        errorMessage += 'Veuillez réessayer.';
                }
                
                addBotMessage(errorMessage);
                isListening = false;
                voiceInputButton.classList.remove('listening');
                voiceInputButton.innerHTML = '<i class="fas fa-microphone"></i>';
                voiceInputButton.title = 'Parler';
                clearTimeout(silenceTimer);
            };
        } else {
            voiceInputButton.style.display = 'none';
            console.warn('Reconnaissance vocale non supportée par ce navigateur.');
        }
    }

    // Initialiser la synthèse vocale
    function initSpeechSynthesis() {
        if (speechSynthesis) {
            // Attendre que les voix soient chargées
            speechSynthesis.onvoiceschanged = function() {
                const voices = speechSynthesis.getVoices();
                // Chercher une voix en français
                currentVoice = voices.find(voice => 
                    voice.lang.startsWith('fr') || voice.name.includes('French')
                ) || voices[0];
                
                // Charger les préférences utilisateur
                loadSavedPreferences();
            };
        }
    }

    // Charger les préférences sauvegardées
    function loadSavedPreferences() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        const savedVoiceOutput = localStorage.getItem('voiceOutput') || 'disabled';
        
        // Appliquer le thème
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-theme');
            themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
            themeToggle.title = 'Passer au thème clair';
        }
        
        // Appliquer les paramètres vocaux
        voiceOutputEnabled = savedVoiceOutput === 'enabled';
        const voiceOutputToggle = document.getElementById('voice-output-toggle');
        const icon = voiceOutputToggle.querySelector('i');
        
        if (voiceOutputEnabled) {
            icon.className = 'fas fa-volume-up';
            voiceOutputToggle.title = 'Désactiver la voix';
            voiceOutputToggle.classList.add('active');
        } else {
            icon.className = 'fas fa-volume-mute';
            voiceOutputToggle.title = 'Activer la voix';
            voiceOutputToggle.classList.remove('active');
        }
    }

    // Fonction pour envoyer un message
    async function sendMessage() {
        const query = userInput.value.trim();
        
        if (!query) return;
        
        // Ajouter le message de l'utilisateur au chat
        addUserMessage(query);
        
        // Effacer le champ de saisie
        userInput.value = '';
        
        // Afficher un indicateur de chargement
        const loadingId = addLoadingMessage();
        
        try {
            // Envoyer la requête au backend
            const response = await fetch(`${API_BASE_URL}/api/search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: query })
            });
            
            const data = await response.json();
            
            // Supprimer l'indicateur de chargement
            removeLoadingMessage(loadingId);
            
            // Ajouter la réponse du bot
            const botMessage = data.message || 'Voici les résultats de votre recherche.';
            addBotMessage(botMessage);
            
            // Afficher les résultats
            displayResults(data.results, data.search_type);
            
            // Mettre à jour l'info de recherche
            updateSearchInfo(query, data.search_type, data.results.length);
            
        } catch (error) {
            console.error('Erreur:', error);
            removeLoadingMessage(loadingId);
            addBotMessage('❌ Désolé, une erreur est survenue lors de la recherche. Veuillez réessayer.');
        }
    }
    
    // Fonction pour ajouter un message utilisateur
    function addUserMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user-message';
        
        const now = new Date();
        const timeString = now.getHours().toString().padStart(2, '0') + ':' + 
                          now.getMinutes().toString().padStart(2, '0');
        
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-header">
                    <strong><i class="fas fa-user"></i> Vous</strong>
                    <span class="message-time">${timeString}</span>
                </div>
                <p>${escapeHtml(text)}</p>
            </div>
        `;
        
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
    }
    
    // Fonction pour ajouter un message du bot
    function addBotMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message bot-message';

        const now = new Date();
        const timeString = now.getHours().toString().padStart(2, '0') + ':' +
                          now.getMinutes().toString().padStart(2, '0');

        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-header">
                    <strong><i class="fas fa-robot"></i> Assistant</strong>
                    <span class="message-time">${timeString}</span>
                </div>
                <p>${escapeHtml(text)}</p>
            </div>
        `;

        chatMessages.appendChild(messageDiv);
        scrollToBottom();

        // Lire le message à voix haute si activé
        if (voiceOutputEnabled && text.length < 500) {
            speakText(text);
        }
    }
    
    // Fonction pour ajouter un message de chargement
    function addLoadingMessage() {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message bot-message';
        messageDiv.id = 'loading-message';
        
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-header">
                    <strong><i class="fas fa-robot"></i> Assistant</strong>
                    <span class="message-time">Maintenant</span>
                </div>
                <p><span class="loading"></span> 🔍 Recherche en cours...</p>
            </div>
        `;
        
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
        
        return 'loading-message';
    }
    
    // Fonction pour supprimer le message de chargement
    function removeLoadingMessage(id) {
        const loadingMessage = document.getElementById(id);
        if (loadingMessage) {
            loadingMessage.remove();
        }
    }
    
    // Fonction pour afficher les résultats dans le tableau
    function displayResults(results, searchType) {
        resultsBody.innerHTML = '';
        
        if (!results || results.length === 0) {
            resultsBody.innerHTML = `
                <tr class="no-results">
                    <td colspan="8">
                        <i class="fas fa-search"></i>
                        <p>Aucun résultat trouvé. Essayez avec d'autres termes de recherche.</p>
                        <button class="try-suggestions-btn" onclick="showSuggestions()">Voir des suggestions</button>
                    </td>
                </tr>
            `;
            return;
        }
        
        results.forEach((result, index) => {
            const row = document.createElement('tr');
            
            // Calculer la largeur de la barre de pertinence
            const relevancePercent = Math.round(result.Similarity * 100);
            const relevanceColor = getRelevanceColor(relevancePercent);
            
            // Déterminer la classe de stock
            const stockValue = parseInt(result.Stock) || 0;
            let stockClass = 'medium-stock';
            if (stockValue > 20) stockClass = 'high-stock';
            if (stockValue < 5) stockClass = 'low-stock';
            
            row.innerHTML = `
                <td><strong class="code-highlight">${escapeHtml(result.Code)}</strong></td>
                <td>${escapeHtml(result.Reference)}</td>
                <td>${escapeHtml(result.Designation)}</td>
                <td><span class="price">${escapeHtml(result.Prix_Gros)} DH</span></td>
                <td><span class="price-detail">${escapeHtml(result.Prix_Detail)} DH</span></td>
                <td><span class="discount">${escapeHtml(result.Remise)}%</span></td>
                <td><span class="stock-badge ${stockClass}">${escapeHtml(result.Stock)}</span></td>
                <td>
                    <div class="relevance-container">
                        <div class="relevance-bar">
                            <div class="relevance-fill" style="width: ${relevancePercent}%; background-color: ${relevanceColor};"></div>
                        </div>
                        <div class="relevance-text">${relevancePercent}%</div>
                    </div>
                </td>
            `;
            
            // Ajouter un effet de surbrillance pour les meilleurs résultats
            if (index === 0 && relevancePercent > 70) {
                row.classList.add('best-match');
            }
            
            resultsBody.appendChild(row);
        });
    }
    
    // Fonction pour mettre à jour les informations de recherche
    function updateSearchInfo(query, searchType, resultCount) {
        let typeText = '';
        let icon = 'fa-search';
        
        switch(searchType) {
            case 'exacte':
                typeText = 'Recherche exacte';
                icon = 'fa-check-circle';
                break;
            case 'similarité':
                typeText = 'Recherche par similarité';
                icon = 'fa-chart-line';
                break;
            case 'stock':
                typeText = 'Recherche par stock';
                icon = 'fa-boxes';
                break;
            case 'large':
                typeText = 'Recherche large';
                icon = 'fa-expand';
                break;
            case 'erreur':
                typeText = 'Erreur';
                icon = 'fa-exclamation-triangle';
                break;
            default:
                typeText = 'Recherche';
                icon = 'fa-search';
        }
        
        searchInfo.innerHTML = `
            <i class="fas ${icon}"></i> 
            <span class="search-query">"${escapeHtml(query)}"</span> - 
            <span class="search-type">${typeText}</span> - 
            <span class="result-count">${resultCount} résultat(s)</span>
        `;
    }
    
    // Fonction pour charger les statistiques
    async function loadStats() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/stats`);
            const data = await response.json();
            
            totalItemsEl.textContent = data.total_items;
            totalStockEl.textContent = data.total_stock;
            
            // Ajouter une animation
            totalItemsEl.style.transform = 'scale(1.2)';
            totalStockEl.style.transform = 'scale(1.2)';
            setTimeout(() => {
                totalItemsEl.style.transform = 'scale(1)';
                totalStockEl.style.transform = 'scale(1)';
            }, 300);
            
        } catch (error) {
            console.error('Erreur lors du chargement des statistiques:', error);
        }
    }

    // Fonction pour charger les suggestions
    async function loadSuggestions() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/suggestions`);
            const data = await response.json();
            suggestions = data.suggestions || [];
        } catch (error) {
            console.error('Erreur lors du chargement des suggestions:', error);
        }
    }

    // Fonction pour naviguer dans les suggestions
    function navigateSuggestions(isDown) {
        if (suggestions.length === 0) return;
        
        if (isDown) {
            suggestionIndex = (suggestionIndex + 1) % suggestions.length;
        } else {
            suggestionIndex = (suggestionIndex - 1 + suggestions.length) % suggestions.length;
        }
        
        // Afficher la suggestion sélectionnée
        if (suggestionIndex >= 0) {
            userInput.value = suggestions[suggestionIndex].replace('Code: ', '').replace('Article: ', '').replace('Référence: ', '');
            userInput.setSelectionRange(userInput.value.length, userInput.value.length);
        }
    }
    
    // Fonction pour obtenir une couleur en fonction de la pertinence
    function getRelevanceColor(percent) {
        if (percent >= 80) return '#06d6a0'; // Vert
        if (percent >= 60) return '#ffd166'; // Jaune
        if (percent >= 40) return '#ff9e6d'; // Orange
        if (percent >= 20) return '#ff8577'; // Rouge clair
        return '#ff6b6b'; // Rouge
    }
    
    // Fonction pour faire défiler vers le bas du chat
    function scrollToBottom() {
        setTimeout(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 100);
    }
    
    // Fonction pour échapper le HTML (sécurité)
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Fonction pour basculer la saisie vocale
    function toggleVoiceInput() {
        if (!recognition) {
            addBotMessage('🎤 La reconnaissance vocale n\'est pas supportée par ce navigateur.');
            return;
        }

        if (isListening) {
            recognition.stop();
            addBotMessage('⏹️ Écoute arrêtée.');
        } else {
            try {
                recognition.start();
            } catch (error) {
                addBotMessage('❌ Impossible de démarrer la reconnaissance vocale. Vérifiez votre microphone.');
            }
        }
    }

    // Fonction pour basculer la sortie vocale
    function toggleVoiceOutput() {
        voiceOutputEnabled = !voiceOutputEnabled;
        const voiceOutputToggle = document.getElementById('voice-output-toggle');
        const icon = voiceOutputToggle.querySelector('i');

        if (voiceOutputEnabled) {
            icon.className = 'fas fa-volume-up';
            voiceOutputToggle.title = 'Désactiver la voix';
            voiceOutputToggle.classList.add('active');
            localStorage.setItem('voiceOutput', 'enabled');
            speakText('Voix activée. Je vais maintenant lire mes réponses à voix haute.');
        } else {
            icon.className = 'fas fa-volume-mute';
            voiceOutputToggle.title = 'Activer la voix';
            voiceOutputToggle.classList.remove('active');
            localStorage.setItem('voiceOutput', 'disabled');
            // Arrêter la synthèse en cours
            if (speechSynthesis && isSpeaking) {
                speechSynthesis.cancel();
            }
        }
    }

    // Fonction pour lire un texte à voix haute
    function speakText(text) {
        if (!speechSynthesis || !voiceOutputEnabled || isSpeaking) {
            return;
        }

        // Arrêter la synthèse en cours
        speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'fr-FR';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        if (currentVoice) {
            utterance.voice = currentVoice;
        }

        utterance.onstart = function() {
            isSpeaking = true;
        };

        utterance.onend = function() {
            isSpeaking = false;
        };

        utterance.onerror = function(event) {
            console.error('Erreur de synthèse vocale:', event.error);
            isSpeaking = false;
        };

        speechSynthesis.speak(utterance);
    }

    // Fonction pour basculer le thème
    function toggleTheme() {
        const body = document.body;
        const themeToggle = document.getElementById('theme-toggle');
        const icon = themeToggle.querySelector('i');

        body.classList.toggle('dark-theme');

        if (body.classList.contains('dark-theme')) {
            icon.className = 'fas fa-sun';
            themeToggle.title = 'Passer au thème clair';
            localStorage.setItem('theme', 'dark');
            addBotMessage('🌙 Thème sombre activé');
        } else {
            icon.className = 'fas fa-moon';
            themeToggle.title = 'Passer au thème sombre';
            localStorage.setItem('theme', 'light');
            addBotMessage('☀️ Thème clair activé');
        }
    }

    // Fonction pour afficher les suggestions
    window.showSuggestions = function() {
        if (suggestions.length > 0) {
            const suggestionsText = suggestions.slice(0, 5).join('\n• ');
            addBotMessage(`💡 Suggestions de recherche :\n• ${suggestionsText}`);
        }
    };

    // Initialisation
    scrollToBottom();
    
    // Ajouter un message de bienvenue
    setTimeout(() => {
        if (document.querySelectorAll('.message').length === 1) {
            addBotMessage('💡 Astuce : Vous pouvez utiliser la reconnaissance vocale en cliquant sur le bouton microphone, ou taper directement votre recherche.');
        }
    }, 2000);
});