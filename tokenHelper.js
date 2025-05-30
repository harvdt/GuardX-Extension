function setAccessTokenCookie(token, expiresInSeconds = 7200) {
	const expiryDate = new Date();
	expiryDate.setTime(expiryDate.getTime() + expiresInSeconds * 1000);

	document.cookie = `twitter_access_token=${token}; path=/; expires=${expiryDate.toUTCString()}; SameSite=Lax`;
}

function getAccessTokenFromCookie() {
	const cookies = document.cookie.split(";");
	for (let i = 0; i < cookies.length; i++) {
		const cookie = cookies[i].trim();
		if (cookie.startsWith("twitter_access_token=")) {
			return cookie.substring("twitter_access_token=".length);
		}
	}
	return null;
}

function deleteAccessTokenCookie() {
	document.cookie =
		"twitter_access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
}

function storeRefreshToken(refreshToken) {
	return new Promise((resolve) => {
		chrome.storage.local.set({ twitter_refresh_token: refreshToken }, () => {
			resolve();
		});
	});
}

function getRefreshToken() {
	return new Promise((resolve) => {
		chrome.storage.local.get(["twitter_refresh_token"], (result) => {
			resolve(result.twitter_refresh_token || null);
		});
	});
}

function deleteRefreshToken() {
	return new Promise((resolve) => {
		chrome.storage.local.remove(["twitter_refresh_token"], () => {
			resolve();
		});
	});
}

async function checkTokens() {
	const accessToken = getAccessTokenFromCookie();
	const refreshToken = await getRefreshToken();

	return {
		hasAccessToken: !!accessToken,
		hasRefreshToken: !!refreshToken,
		accessToken,
		refreshToken,
	};
}

window.tokenHelper = {
	setAccessTokenCookie,
	getAccessTokenFromCookie,
	deleteAccessTokenCookie,
	storeRefreshToken,
	getRefreshToken,
	deleteRefreshToken,
	checkTokens,
};
