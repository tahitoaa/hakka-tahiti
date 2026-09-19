"""
URL configuration for hakkadbapp project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path
from . import views
# urls.py
from django.urls import path, re_path

urlpatterns = [
    # path('admin/', admin.site.urls),
    path('', views.flashcards, name='flashcards'),
    # path('pronunciation/new/', views.newPronunciation, name='new_pronunciation'),
    # path('pronunciation/<int:pk>/edit/', views.edit_pronunciation, name='edit_pronunciation'),
    # path('pronunciation/<int:pk>/delete/', views.delete_pronunciation, name='delete_pronunciation'),
    # path('words/new/', views.new_word, name='new_word'),
    # path('words/<int:pk>/edit/', views.edit_word, name='edit_word'),
    # path('pronunciations/export', views.pronunciation_csv, name='pronunciation_csv'),
    # path('words/export', views.word_csv, name='word_csv'),
    # path('static', views.static, name='static'),
    # 
    path('reports', views.reports, name='reports'),
    path('doublons', views.duplicates_view, name='duplicates'),
    path("search/", views.search, name="search"),
    # path("browse", views.browse, name="browse"),
    path("converter/", views.pinyin_converter, name="pinyin_converter"),
    path("transcripter/", views.transcripter, name="transcripter"),
    path("caracters", views.caracters, name="caracters"),
    path("flashcards/", views.flashcards, name="flashcards"),
    path("flashcards/<str:category>", views.flashcards, name="flashcards"),
    # path("hanzi/<str:hanzi_char>", views.hanzi, name="hanzi"),
    re_path(r'^hanzi/(?P<hanzi_char>[^/]+)/$', views.hanzi, name='hanzi'),
    path("phonemes/", views.phonemes, name="phonemes"),
    path('hanzi_by_pinyin/<str:syllable>', views.hanzi_by_pinyin, name='hanzi_by_pinyin'),
    path('hanzi_by_tone/<int:tone>', views.hanzi_by_tone, name='hanzi_by_tone'),
    path('pronunciation/', views.pronunciation, name='pronunciation'),
    path('expressions/', views.expressions, name='expressions'),
    path("api/convert-text/", views.api_convert_text, name="api_convert_text"),
    path("api/words-data/", views.api_words_data, name="api_words_data"),
    path("expression-mesh/download", views.expression_mesh_download, name="expression_mesh_download"),
    path("expression-mesh/upload", views.expression_mesh_upload, name="expression_mesh_upload"),
    path("expression-mesh/<int:expr_id>", views.expression_mesh_entry, name="expression_mesh_entry"),
    path("expression-mesh/<int:expr_id>/reset", views.expression_mesh_reset, name="expression_mesh_reset"),
    path("export-corpus", views.export_corpus_generate, name="export_corpus_generate"),
    path("export-corpus/expressions.xlsx", views.export_expressions_spreadsheet, name="export_expressions_spreadsheet"),
    path("expression-mesh/sync", views.expression_mesh_sync, name="expression_mesh_sync"),
    path("word-notes/<int:word_id>", views.word_note_entry, name="word_note_entry"),
]
