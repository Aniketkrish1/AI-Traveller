// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    
    // Get references to the form and output elements
    const plannerForm = document.getElementById('planner-form');
    const loadingEl = document.getElementById('loading');
    const outputEl = document.getElementById('itinerary-output');
    const generateBtn = document.getElementById('generate-btn');

    // Listen for the form submission
    plannerForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // Prevent the form from reloading the page

        // 1. Get user inputs from the form
        const startCity = document.getElementById('start-city').value;
        const destination = document.getElementById('destination').value;
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;
        const interests = document.getElementById('interests').value;
        const style = document.getElementById('style').value;

        // 2. Show loading message and disable button
        loadingEl.classList.remove('hidden');
        outputEl.innerHTML = ''; // Clear old results
        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating...';

        try {
            // 3. Send data to the backend server
            const response = await fetch('/.netlify/functions/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    startCity,
                    destination,
                    dates: `${startDate} - ${endDate}`,
                    interests,
                    style
                }),
            });

            if (!response.ok) {
                throw new Error('Network response was not ok.');
            }

            const data = await response.json();

            // 4. Save the structured result in sessionStorage and navigate to results page
            // also save the original query so results page can show search summary
            try {
                const query = { startCity, destination, startDate, endDate, interests, style };
                sessionStorage.setItem('aiTravelQuery', JSON.stringify(query));
                sessionStorage.setItem('aiTravelResults', JSON.stringify(data));
                window.location.href = 'results.html';
                return; // stop further execution on this page
            } catch (storageErr) {
                console.error('Failed to save results to sessionStorage', storageErr);
                // Fallback: render itinerary as before
                const formattedHtml = marked.parse(data.itinerary || '');
                outputEl.innerHTML = `<div class="itinerary-card">${formattedHtml}</div>`;
            }

        } catch (error) {
            console.error('Error:', error);
            outputEl.innerHTML = `<div class="itinerary-card" style="color: red;"><strong>Error:</strong> ${error.message}</div>`;
        } finally {
            // 5. Hide loading message and re-enable button
            loadingEl.classList.add('hidden');
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate My Trip';
        }
    });
});